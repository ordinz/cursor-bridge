import { finalizeAgentName, sendAgentMessage } from "./agents.js";
import { nameFromPrompt } from "./agent-names.js";
import { createSseEvent } from "./sse-events.js";
import { consumeRun } from "./stream.js";
import { buildPromptWithDevLogs } from "./dev-logs.js";
import { validateCombinedPrompt } from "./validate.js";
import {
  claimNextForSession,
  markQueueDone,
  markQueueFailed,
} from "./prompt-queue.js";

/**
 * Execute a single prompt on a live session (no HTTP response).
 * Used for queued drains and shared internals.
 *
 * @param {import("./sessions.js").SessionManager} sessions
 * @param {{
 *   sessionId: string,
 *   prompt: string,
 *   images?: { data: string, mimeType: string }[],
 *   includeDevLogs?: boolean,
 *   source?: string,
 *   queueId?: string|null,
 * }} opts
 */
export async function executeSessionPrompt(sessions, opts) {
  const {
    sessionId,
    prompt,
    images = [],
    includeDevLogs = false,
    source = "api",
    queueId = null,
  } = opts;

  let record = await sessions.ensureLiveAgent(sessionId);

  let agentPrompt = prompt;
  let devLogsMeta = null;
  if (includeDevLogs) {
    try {
      const augmented = await buildPromptWithDevLogs(record.project, prompt);
      agentPrompt = validateCombinedPrompt(prompt, augmented.prompt);
      devLogsMeta = {
        logsAttached: augmented.logsAttached,
        logLineCount: augmented.logLineCount,
        source: augmented.source,
      };
    } catch (err) {
      console.warn(
        "[execute-prompt] dev logs attach failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (!record.namedFromPrompt) {
    sessions.setInterimName(sessionId, nameFromPrompt(prompt));
    record = sessions.require(sessionId);
  }

  sessions.notePrompt(sessionId, prompt);
  sessions.startRunEvents(sessionId);

  const publish = (event) => sessions.publishEvent(sessionId, event);

  publish(
    createSseEvent("session", sessionId, {
      agentId: record.agentId,
      project: record.project,
      cwd: record.cwd,
      name: record.name,
      runStatus: "running",
      runActive: true,
    }),
  );
  publish(
    createSseEvent("status", sessionId, {
      status: "RUNNING",
      message: queueId ? "Run started (queue)" : "Run started",
    }),
  );
  if (devLogsMeta) {
    const config = devLogsMeta.logsAttached
      ? `Included ${devLogsMeta.logLineCount} lines of dev server logs from ${record.project} (source: ${devLogsMeta.source})`
      : `No dev server logs available for ${record.project}`;
    publish(
      createSseEvent("status", sessionId, {
        status: "DEV_LOGS",
        message: config,
      }),
    );
  }
  publish(
    createSseEvent("user", sessionId, {
      text: prompt,
      source,
      ...(images.length ? { imageCount: images.length } : {}),
    }),
  );

  try {
    const abortController = new AbortController();
    const sendMessage =
      images.length > 0 ? { text: agentPrompt, images } : agentPrompt;
    const run = await sendAgentMessage(record.agent, sendMessage, undefined, {
      agentId: record.agentId,
      cwd: record.cwd,
    });
    sessions.setActiveRun(sessionId, run, abortController);

    const outcome = await consumeRun(run, {
      sessionId,
      signal: abortController.signal,
      onEvent: (event) => {
        publish(event);
        if (event.type === "assistant" && event.text) {
          sessions.noteAssistantText(sessionId, event.text);
        }
      },
    });

    if (outcome.cancelled) {
      sessions.clearActiveRun(sessionId, "cancelled");
      if (queueId) markQueueFailed(queueId, "cancelled");
    } else if (outcome.failed) {
      sessions.clearActiveRun(sessionId, "error");
      if (queueId) markQueueFailed(queueId, "run failed");
    } else {
      sessions.clearActiveRun(sessionId, "idle");
      if (queueId) markQueueDone(queueId);

      if (sessions.scheduleNaming(sessionId)) {
        const snapshot = sessions.get(sessionId);
        if (snapshot) {
          void finalizeAgentName({
            sessions,
            sessionId,
            agentId: snapshot.agentId,
            project: snapshot.project,
            cwd: snapshot.cwd,
            prompt,
            assistantSnippet: snapshot.lastAssistantSnippet,
          });
        }
      }
    }
  } catch (err) {
    sessions.clearActiveRun(sessionId, "error");
    if (queueId) {
      markQueueFailed(queueId, err instanceof Error ? err.message : "run failed");
    }
    throw err;
  } finally {
    void drainSessionQueue(sessions, sessionId);
  }
}

/** @type {Set<string>} */
const draining = new Set();

/**
 * Claim and run the next queued prompt for a session (serial).
 * @param {import("./sessions.js").SessionManager} sessions
 * @param {string} sessionId
 */
export async function drainSessionQueue(sessions, sessionId) {
  if (draining.has(sessionId)) return;
  draining.add(sessionId);
  try {
    while (true) {
      const item = claimNextForSession(sessionId);
      if (!item) break;
      try {
        await executeSessionPrompt(sessions, {
          sessionId,
          prompt: item.prompt,
          images: item.images || [],
          includeDevLogs: item.includeDevLogs,
          source: item.source || "api",
          queueId: item.id,
        });
      } catch (err) {
        console.warn(
          "[prompt-queue] drain failed:",
          err instanceof Error ? err.message : err,
        );
        // Loop continues if more items and session idle
      }
      const record = sessions.get(sessionId);
      if (!record || record.runStatus === "running") break;
    }
  } finally {
    draining.delete(sessionId);
  }
}
