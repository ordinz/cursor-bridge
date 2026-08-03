import express from "express";
import { Agent, Cursor } from "@cursor/sdk";
import {
  buildAgentName,
  isBridgeNamingAgent,
  nameFromPrompt,
} from "./agent-names.js";
import {
  archiveLocalAgent,
  deleteLocalAgent,
  finalizeAgentName,
  sendAgentMessage,
  unarchiveLocalAgent,
} from "./agents.js";
import { loadAgentHistory } from "./agent-history.js";
import { searchLocalAgents } from "./agent-search.js";
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
import { createSseEvent, writeSseEvent } from "./sse-events.js";
import { setupSse, startHeartbeat, streamRun } from "./stream.js";
import { VERSION } from "./version.js";
import {
  isTelegramConfigured,
  isTelegramEnabled,
  isTelegramWebhookConfigured,
  sendTelegramMessage,
  TelegramNotConfiguredError,
  TelegramSendError,
} from "./telegram.js";
import { getPhoneModeState } from "./telegram-phone.js";
import {
  buildPromptWithDevLogs,
  DevLogsError,
  getDevStatus,
  getRecentLogs,
  startDevServer,
  stopDevServer,
} from "./dev-logs.js";
import {
  InvalidRequestError,
  validateChatPayload,
  validateCombinedPrompt,
  validateProjectId,
  validatePrompt,
  validateSessionId,
  validateTelegramMessage,
} from "./validate.js";
import {
  listConversationReads,
  markConversationRead,
  removeConversationRead,
} from "./conversation-reads.js";
import {
  cancelQueueItem,
  enqueueOrClaim,
  getQueue,
  listQueue,
} from "./prompt-queue.js";
import { drainSessionQueue } from "./execute-prompt.js";

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
      const activeRuns = sessions.countActiveRuns();
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
        agents: {
          activeRuns,
          sessionCount: sessions.sessions.size,
        },
        telegram: {
          enabled: isTelegramEnabled(),
          configured: isTelegramConfigured(),
          webhookConfigured: isTelegramWebhookConfigured(),
          phoneMode: getPhoneModeState().phoneMode,
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

  router.get("/projects/:projectId/dev-status", async (req, res, next) => {
    try {
      const projectId = validateProjectId(req.params.projectId);
      resolveProject(projectId);
      const status = await getDevStatus(projectId);
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  router.get("/projects/:projectId/dev-logs", async (req, res, next) => {
    try {
      const projectId = validateProjectId(req.params.projectId);
      resolveProject(projectId);
      const lines = Math.min(
        Math.max(Number(req.query.lines) || 150, 1),
        500,
      );
      const logs = await getRecentLogs(projectId, { lines });
      res.json(logs);
    } catch (err) {
      next(err);
    }
  });

  router.post("/projects/:projectId/dev-server", async (req, res, next) => {
    try {
      const projectId = validateProjectId(req.params.projectId);
      resolveProject(projectId);
      const action = req.body?.action;
      if (action === "start") {
        const result = await startDevServer(projectId);
        return res.json(result);
      }
      if (action === "stop") {
        const result = await stopDevServer(projectId);
        return res.json(result);
      }
      throw new InvalidRequestError('action must be "start" or "stop"');
    } catch (err) {
      next(err);
    }
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
      const includeArchived = req.query.includeArchived === "true";
      const q =
        typeof req.query.q === "string" ? req.query.q.trim() : "";
      const cursor =
        typeof req.query.cursor === "string" && req.query.cursor
          ? req.query.cursor
          : undefined;
      const limitRaw = Number(req.query.limit);
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.min(Math.floor(limitRaw), 100)
          : 50;

      // Deep search: walk Agent.list pages server-side and return matches.
      if (q) {
        const searched = await searchLocalAgents({
          list: (opts) => Agent.list(opts),
          cwd,
          query: q,
          includeArchived,
        });
        res.json({
          agents: searched.agents,
          nextCursor: searched.nextCursor,
          searchExhausted: searched.exhausted,
          pagesSearched: searched.pagesSearched,
        });
        return;
      }

      const result = await Agent.list({
        runtime: "local",
        cwd,
        limit,
        ...(cursor ? { cursor } : {}),
      });

      const agents = (result.items || []).filter((a) => {
        if (!a || isBridgeNamingAgent(a)) return false;
        if (!includeArchived && a.archived) return false;
        return true;
      });

      res.json({
        agents,
        nextCursor: result.nextCursor ?? null,
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

  router.post("/agents/:agentId/archive", async (req, res, next) => {
    try {
      const project = validateProjectId(req.query.project);
      const closedSessions = await sessions.closeByAgentId(req.params.agentId);
      await archiveLocalAgent(req.params.agentId, project);
      removeConversationRead(project, req.params.agentId);
      res.json({
        ok: true,
        closedSession: closedSessions[0] ?? null,
        closedSessions,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/agents/:agentId/unarchive", async (req, res, next) => {
    try {
      const project = validateProjectId(req.query.project);
      await unarchiveLocalAgent(req.params.agentId, project);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/agents/:agentId", async (req, res, next) => {
    try {
      const project = validateProjectId(req.query.project);
      const closedSessions = await sessions.closeByAgentId(req.params.agentId);
      await deleteLocalAgent(req.params.agentId, project);
      removeConversationRead(project, req.params.agentId);
      res.json({
        ok: true,
        closedSession: closedSessions[0] ?? null,
        closedSessions,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/conversation-reads", (_req, res) => {
    res.json({ reads: listConversationReads() });
  });

  router.post("/conversation-reads/read", (req, res, next) => {
    try {
      const project = validateProjectId(req.body?.project);
      const agentId =
        typeof req.body?.agentId === "string" ? req.body.agentId.trim() : "";
      if (!agentId) {
        throw new InvalidRequestError("agentId is required");
      }
      const entry = markConversationRead(project, agentId);
      res.json({ ok: true, key: `${project}:${agentId}`, entry });
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

      // Phone mode: each new UI/API agent gets its own Telegram forum topic.
      if (getPhoneModeState().phoneMode) {
        try {
          const { ensureAgentTelegramTopic } = await import(
            "./telegram-topics.js"
          );
          const binding = await ensureAgentTelegramTopic(session);
          if (binding) {
            sessions.setTelegramThreadId(session.sessionId, binding.threadId);
            session.telegramThreadId = binding.threadId;
          }
        } catch (err) {
          console.warn(
            "[sessions] telegram topic spawn failed:",
            err?.message || err,
          );
        }
      }

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

  router.get("/sessions/:id/events", (req, res, next) => {
    try {
      const id = validateSessionId(req.params.id);
      sessions.require(id);

      setupSse(res);
      const heartbeat = startHeartbeat(res);
      const replay = req.query.replay !== "0";
      const afterSeq = Number(req.query.after) || 0;
      const unsubscribe = sessions.events.subscribe(id, res, {
        replay,
        afterSeq,
      });

      req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/sessions/:id/queue", (req, res, next) => {
    try {
      const id = validateSessionId(req.params.id);
      sessions.require(id);
      const status = req.query.status ? String(req.query.status) : null;
      res.json({ items: listQueue({ sessionId: id, status }) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/queue", (req, res, next) => {
    try {
      const project = req.query.project
        ? validateProjectId(String(req.query.project))
        : null;
      const status = req.query.status ? String(req.query.status) : null;
      res.json({ items: listQueue({ project, status }) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/queue/:qid", (req, res, next) => {
    try {
      const item = getQueue(req.params.qid);
      if (!item) {
        throw new InvalidRequestError("queue item not found");
      }
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  router.delete("/queue/:qid", (req, res, next) => {
    try {
      const item = cancelQueueItem(req.params.qid);
      if (!item) {
        throw new InvalidRequestError(
          "queue item not found or not cancellable",
        );
      }
      res.json({ ok: true, item });
    } catch (err) {
      next(err);
    }
  });

  router.post("/sessions/:id/chat", async (req, res, next) => {
    const { allowOverlap = false, includeDevLogs = false } = req.body ?? {};

    try {
      const id = validateSessionId(req.params.id);
      const { text: userPrompt, images } = validateChatPayload(
        req.body?.prompt,
        req.body?.images,
      );

      let record = await sessions.ensureLiveAgent(id);

      const source = req.body?.source === "manual" ? "manual" : "api";
      const claim = enqueueOrClaim({
        sessionId: id,
        project: record.project,
        prompt: userPrompt,
        images,
        includeDevLogs: Boolean(includeDevLogs),
        source,
        allowOverlap: Boolean(allowOverlap),
      });

      if (claim.reason === "missing") {
        throw new SessionNotFoundError(id);
      }

      if (claim.mode === "queued") {
        return res.status(202).json({
          ok: true,
          queued: true,
          item: claim.item,
          sessionId: id,
        });
      }

      // DB already marked running for the immediate claim — sync memory.
      record = sessions.require(id);
      if (record.runStatus !== "running") {
        record.runStatus = "running";
        sessions.persist(id);
      }

      let agentPrompt = userPrompt;
      let devLogsMeta = null;
      if (includeDevLogs) {
        const augmented = await buildPromptWithDevLogs(
          record.project,
          userPrompt,
        );
        agentPrompt = validateCombinedPrompt(userPrompt, augmented.prompt);
        devLogsMeta = {
          logsAttached: augmented.logsAttached,
          logLineCount: augmented.logLineCount,
          source: augmented.source,
        };
      }

      setupSse(res);

      try {
        if (!record.namedFromPrompt) {
          sessions.setInterimName(id, nameFromPrompt(userPrompt));
          record = sessions.get(id);
        }

        sessions.notePrompt(id, userPrompt);
        sessions.startRunEvents(id);

        const publish = (event) => sessions.publishEvent(id, event, res);
        // Never embed base64 in SSE — a single JPEG can stall the feed after
        // "Run started" so the UI only shows status + "Run in progress…".
        // The web client paints attachments optimistically; agent.send gets
        // structured SDK images below.
        const sdkImages = images.map(({ data, mimeType }) => ({
          data,
          mimeType,
        }));
        const sendMessage =
          sdkImages.length > 0
            ? { text: agentPrompt, images: sdkImages }
            : agentPrompt;

        publish(
          createSseEvent("session", id, {
            agentId: record.agentId,
            project: record.project,
            cwd: record.cwd,
            name: record.name,
            runStatus: "running",
            runActive: true,
          }),
        );

        publish(
          createSseEvent("status", id, {
            status: "RUNNING",
            message: "Run started",
          }),
        );

        if (devLogsMeta) {
          const config = devLogsMeta.logsAttached
            ? `Included ${devLogsMeta.logLineCount} lines of dev server logs from ${record.project} (source: ${devLogsMeta.source})`
            : `No dev server logs available for ${record.project} — start dev with log capture or pipe output to ~/.cursor-bridge/dev-logs/${record.project}.log`;
          publish(
            createSseEvent("status", id, {
              status: "DEV_LOGS",
              message: config,
            }),
          );
        }

        publish(
          createSseEvent("user", id, {
            text: userPrompt,
            source,
            ...(sdkImages.length ? { imageCount: sdkImages.length } : {}),
          }),
        );

        const abortController = new AbortController();
        const run = await sendAgentMessage(record.agent, sendMessage, undefined, {
          agentId: record.agentId,
          cwd: record.cwd,
        });
        sessions.setActiveRun(id, run, abortController);

        const outcome = await streamRun(res, run, {
          sessionId: id,
          signal: abortController.signal,
          publish,
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

          if (sessions.scheduleNaming(id)) {
            const snapshot = sessions.get(id);
            if (snapshot) {
              void finalizeAgentName({
                sessions,
                sessionId: id,
                agentId: snapshot.agentId,
                project: snapshot.project,
                cwd: snapshot.cwd,
                prompt: userPrompt,
                assistantSnippet: snapshot.lastAssistantSnippet,
              });
            }
          }
        }
      } catch (err) {
        sessions.clearActiveRun(id, "error");
        if (!res.writableEnded) {
          const raw = err.message ?? "Run failed";
          const busy = /already has (?:an )?active run/i.test(raw);
          sessions.publishEvent(
            id,
            createSseEvent("error", id, {
              message: busy
                ? "Still working on the previous message — tap Stop, or wait for it to finish."
                : raw,
              code: busy ? "AGENT_BUSY" : "RUN_FAILED",
            }),
            res,
          );
        }
      } finally {
        if (!res.writableEnded) {
          res.end();
        }
        void drainSessionQueue(sessions, id);
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

  async function handleTelegramSend(req, res, next) {
    try {
      const message = validateTelegramMessage(req.body?.message);
      const result = await sendTelegramMessage(message);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  router.post("/telegram", handleTelegramSend);
  router.post("/telegram/send", handleTelegramSend);

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
                : err instanceof TelegramNotConfiguredError
                  ? err.status
                  : err instanceof TelegramSendError
                  ? err.status
                  : err instanceof DevLogsError
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
