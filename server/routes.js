import express from "express";
import { Agent, Cursor } from "@cursor/sdk";
import { buildAgentName } from "./agent-names.js";
import { deleteLocalAgent, updateLocalAgentName } from "./agents.js";
import { loadAgentHistory } from "./agent-history.js";
import { listProjects, resolveProject, ProjectError, PROJECTS_ROOT, ENABLED_PROJECT_IDS } from "./projects.js";
import { setupSse, writeSse, streamRun } from "./stream.js";

export function createRouter(sessions) {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      apiKeyConfigured: Boolean(process.env.CURSOR_API_KEY),
    });
  });

  router.get("/projects", (_req, res) => {
    res.json({
      projects: listProjects(),
      root: PROJECTS_ROOT,
      enabledProjects: ENABLED_PROJECT_IDS,
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
      const { project } = req.query;
      if (!project || typeof project !== "string") {
        return res.status(400).json({ error: "project query param is required" });
      }

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
      const { project } = req.query;
      if (!project || typeof project !== "string") {
        return res.status(400).json({ error: "project query param is required" });
      }

      const items = await loadAgentHistory(req.params.agentId, project);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/agents/:agentId", async (req, res, next) => {
    try {
      const { project } = req.query;
      if (!project || typeof project !== "string") {
        return res.status(400).json({ error: "project query param is required" });
      }

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

  router.post("/sessions", async (req, res, next) => {
    try {
      const { project, model = "default" } = req.body ?? {};
      const session = await sessions.create({ project, model });
      res.status(201).json(session);
    } catch (err) {
      next(err);
    }
  });

  router.post("/sessions/resume", async (req, res, next) => {
    try {
      const { agentId, project, model = "default" } = req.body ?? {};
      if (!agentId) {
        return res.status(400).json({ error: "agentId is required" });
      }
      if (!project) {
        return res.status(400).json({ error: "project is required" });
      }
      const session = await sessions.resumeAgent({ agentId, project, model });
      res.status(201).json(session);
    } catch (err) {
      next(err);
    }
  });

  router.post("/sessions/:id/chat", async (req, res, next) => {
    const { prompt } = req.body ?? {};
    const { id } = req.params;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required" });
    }

    const record = sessions.get(id);
    if (!record) {
      return res.status(404).json({ error: "session not found" });
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
      }

      writeSse(res, {
        type: "session",
        sessionId: record.sessionId,
        agentId: record.agentId,
        project: record.project,
        cwd: record.cwd,
        name: record.name,
      });

      writeSse(res, { type: "user", text: prompt, source: "api" });

      const run = await record.agent.send(prompt);
      sessions.setActiveRun(id, run);

      await streamRun(res, run, {
        sessionId: record.sessionId,
        agentId: record.agentId,
      });

      sessions.clearActiveRun(id, "idle");
    } catch (err) {
      sessions.clearActiveRun(id, "error");
      writeSse(res, { type: "error", message: err.message });
    }

    res.end();
  });

  router.post("/sessions/:id/cancel", async (req, res, next) => {
    try {
      const cancelled = await sessions.cancel(req.params.id);
      if (!cancelled) {
        return res.status(404).json({ error: "session not found or not cancellable" });
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/sessions/:id", async (req, res, next) => {
    try {
      const closed = await sessions.close(req.params.id);
      if (!closed) {
        return res.status(404).json({ error: "session not found" });
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.use((err, _req, res, _next) => {
    const status = err instanceof ProjectError ? err.status : 500;
    res.status(status).json({ error: err.message ?? "internal error" });
  });

  return router;
}

export async function handleLegacyPrompt(req, res, sessions) {
  const { prompt, project = "app", model = "default" } = req.body ?? {};

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "prompt is required" });
  }

  setupSse(res);

  try {
    const cwd = resolveProject(project);
    const agent = await Agent.create({
      apiKey: process.env.CURSOR_API_KEY,
      name: buildAgentName({ project, model, prompt }),
      model: { id: model },
      local: { cwd },
    });

    try {
      const run = await agent.send(prompt);
      await streamRun(res, run);
    } finally {
      agent.close();
    }
  } catch (err) {
    writeSse(res, { type: "error", message: err.message });
  }

  res.end();
}
