import express from "express";
import { Agent, Cursor } from "@cursor/sdk";
import { buildAgentName } from "./agent-names.js";
import { deleteLocalAgent, updateLocalAgentName } from "./agents.js";
import { loadAgentHistory } from "./agent-history.js";
import { checkCursorConnectivity } from "./cursor-health.js";
import {
  errorBody,
  NoActiveRunError,
  SessionBusyError,
  SessionNotFoundError,
} from "./errors.js";
import { buildOpenApiSpec } from "./openapi.js";
import {
  listProjects,
  resolveProject,
  ProjectError,
} from "./projects.js";
import { writeSseEvent } from "./sse-events.js";
import { setupSse, streamRun } from "./stream.js";
import { VERSION } from "./version.js";
import {
  InvalidRequestError,
  validateProjectId,
  validatePrompt,
  validateSessionId,
} from "./validate.js";

export function createRouter(sessions) {
  const router = express.Router();

  router.get("/openapi.json", (req, res) => {
    const host = process.env.HOST ?? "127.0.0.1";
    const port = Number(process.env.PORT ?? 4242);
    const proto = req.protocol ?? "http";
    res.json(buildOpenApiSpec(`${proto}://${host}:${port}`));
  });

  router.get("/health", async (_req, res, next) => {
    try {
      const cursor = await checkCursorConnectivity();
      res.json({
        ok: true,
        version: VERSION,
        bridge: {
          status: "up",
          host: process.env.HOST ?? "127.0.0.1",
          port: Number(process.env.PORT ?? 4242),
        },
        cursor: {
          apiKeyConfigured: Boolean(process.env.CURSOR_API_KEY),
          ready: cursor.ready,
          reason: cursor.reason ?? null,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/projects", (_req, res) => {
    res.json({
      projects: listProjects().map((p) => ({
        id: p.id,
        name: p.name,
        canCreateSession: true,
      })),
    });
  });

  router.get("/models", async (_req, res, next) => {
    try {
      const models = await Cursor.models.list({
        apiKey: process.env.CURSOR_API_KEY,
      });
      res.json({
        models: models.map((m) => ({
          id: m.id,
          displayName: m.displayName,
          description: m.description,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/agents", async (req, res, next) => {
    try {
      const project = validateProjectId(req.query.project);
      const cwd = resolveProject(project);
      const result = await Agent.list({
        runtime: "local",
        cwd,
        limit: 50,
      });

      res.json({
        agents: result.items,
        nextCursor: result.nextCursor,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/agents/:agentId/history", async (req, res, next) => {
    try {
      const project = validateProjectId(req.query.project);
      const items = await loadAgentHistory(req.params.agentId, project);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/agents/:agentId", async (req, res, next) => {
    try {
      const project = validateProjectId(req.query.project);
      const closed = await sessions.closeByAgentId(req.params.agentId);
      await deleteLocalAgent(req.params.agentId, project);
      res.json({ ok: true, closedSession: closed });
    } catch (err) {
      next(err);
    }
  });

  router.get("/sessions", (_req, res) => {
    res.json({ sessions: sessions.list() });
  });

  router.get("/sessions/:id", (req, res, next) => {
    try {
      const id = validateSessionId(req.params.id);
      const detail = sessions.getDetail(id);
      if (!detail) {
        throw new SessionNotFoundError(id);
      }
      res.json(detail);
    } catch (err) {
      next(err);
    }
  });

  router.post("/sessions", async (req, res, next) => {
    try {
      const { model = "default" } = req.body ?? {};
      const project = validateProjectId(req.body?.project);
      const session = await sessions.create({ project, model });
      res.status(201).json(session);
    } catch (err) {
      next(err);
    }
  });

  router.post("/sessions/resume", async (req, res, next) => {
    try {
      const { agentId, model = "default" } = req.body ?? {};
      const project = validateProjectId(req.body?.project);
      if (!agentId || typeof agentId !== "string") {
        throw new InvalidRequestError("agentId is required");
      }
      const session = await sessions.resumeAgent({ agentId, project, model });
      res.status(201).json(session);
    } catch (err) {
      next(err);
    }
  });

  router.post("/sessions/:id/chat", async (req, res, next) => {
    const { allowOverlap = false } = req.body ?? {};

    try {
      const id = validateSessionId(req.params.id);
      const prompt = validatePrompt(req.body?.prompt);

      let record;
      if (allowOverlap) {
        record = sessions.get(id);
        if (!record) {
          throw new SessionNotFoundError(id);
        }
      } else {
        record = sessions.assertCanChat(id);
      }

      setupSse(res);

      try {
        if (!record.namedFromPrompt) {
          const name = await updateLocalAgentName(
            record.agentId,
            record.project,
            prompt,
          );
          sessions.markNamedFromPrompt(id, name);
          record = sessions.get(id);
        }

        sessions.notePrompt(id, prompt);

        writeSseEvent(res, "session", id, {
          agentId: record.agentId,
          project: record.project,
          cwd: record.cwd,
          name: record.name,
          runStatus: "running",
          runActive: true,
        });

        writeSseEvent(res, "status", id, {
          status: "RUNNING",
          message: "Run started",
        });

        writeSseEvent(res, "user", id, { text: prompt, source: "api" });

        const abortController = new AbortController();
        const run = await record.agent.send(prompt);
        sessions.setActiveRun(id, run, abortController);

        const outcome = await streamRun(res, run, {
          sessionId: id,
          signal: abortController.signal,
          onEvent: (event) => {
            if (event.type === "assistant" && event.text) {
              sessions.noteAssistantText(id, event.text);
            }
          },
        });

        if (outcome.cancelled) {
          sessions.clearActiveRun(id, "cancelled");
        } else if (outcome.failed) {
          sessions.clearActiveRun(id, "error");
        } else {
          sessions.clearActiveRun(id, "idle");
        }
      } catch (err) {
        sessions.clearActiveRun(id, "error");
        if (!res.writableEnded) {
          writeSseEvent(res, "error", id, {
            message: err.message ?? "Run failed",
            code: "RUN_FAILED",
          });
        }
      } finally {
        if (!res.writableEnded) {
          res.end();
        }
      }
    } catch (err) {
      if (
        err instanceof SessionNotFoundError ||
        err instanceof SessionBusyError ||
        err instanceof InvalidRequestError
      ) {
        return res
          .status(err.status)
          .json(errorBody(err, { sessionId: req.params.id }));
      }
      return next(err);
    }
  });

  router.post("/sessions/:id/cancel", async (req, res, next) => {
    try {
      const id = validateSessionId(req.params.id);
      const result = await sessions.cancel(id);
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/sessions/:id", async (req, res, next) => {
    try {
      const id = validateSessionId(req.params.id);
      sessions.require(id);
      const closed = await sessions.close(id);
      if (!closed) {
        throw new SessionNotFoundError(id);
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.use((err, _req, res, _next) => {
    const status =
      err instanceof ProjectError
        ? err.status
        : err instanceof SessionNotFoundError
          ? err.status
          : err instanceof SessionBusyError
            ? err.status
            : err instanceof NoActiveRunError
              ? err.status
              : err instanceof InvalidRequestError
                ? err.status
                : 500;
    res.status(status).json(errorBody(err));
  });

  return router;
}

export async function handleLegacyPrompt(req, res) {
  try {
    const { project = "app", model = "default" } = req.body ?? {};
    const prompt = validatePrompt(req.body?.prompt);
    validateProjectId(project);

    setupSse(res);
    const sessionId = null;

    try {
      const cwd = resolveProject(project);
      const agent = await Agent.create({
        apiKey: process.env.CURSOR_API_KEY,
        name: buildAgentName({ project, model, prompt }),
        model: { id: model },
        local: { cwd },
      });

      try {
        writeSseEvent(res, "user", sessionId, { text: prompt, source: "api" });
        const run = await agent.send(prompt);
        await streamRun(res, run, { sessionId });
      } finally {
        agent.close();
      }
    } catch (err) {
      if (!res.writableEnded) {
        writeSseEvent(res, "error", sessionId, {
          message: err.message,
          code: "RUN_FAILED",
        });
      }
    } finally {
      res.end();
    }
  } catch (err) {
    if (err instanceof InvalidRequestError || err instanceof ProjectError) {
      return res.status(err.status).json(errorBody(err));
    }
    return res.status(500).json(errorBody(err));
  }
}
