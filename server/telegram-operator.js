import { nameFromPrompt } from "./agent-names.js";
import { finalizeAgentName } from "./agents.js";
import { checkCursorConnectivity } from "./cursor-health.js";
import { createSseEvent } from "./sse-events.js";
import { consumeRun } from "./stream.js";
import { VERSION } from "./version.js";
import { createDraftStreamer } from "./telegram-draft.js";
import {
  getPhoneModeState,
  isPhoneModeOn,
  setPhoneMode,
} from "./telegram-phone.js";
import {
  getTelegramAllowedUserIds,
  getTelegramChatId,
  getTelegramTopicMap,
  getTelegramWebhookSecret,
  isTelegramWebhookConfigured,
  sendTelegramMessage,
  sendTelegramRichMessage,
  TELEGRAM_BOT_COMMANDS,
} from "./telegram.js";
import { buildTelegramRichContent } from "./telegram-format.js";
import {
  catchUpAgentHistory,
  claimIdeMirrorRun,
  getIdeMirrorStatus,
  releaseIdeMirrorRun,
  startIdeAgentMirror,
  stopIdeAgentMirror,
} from "./telegram-ide-mirror.js";
import {
  ensureAgentTelegramTopic,
  resolveTelegramThread,
} from "./telegram-topics.js";

/** @type {Map<string, Promise<void>>} */
const projectRunLocks = new Map();

function projectTopicNames() {
  const map = getTelegramTopicMap();
  return Object.entries(map)
    .filter(([label, id]) => label !== "status" && id != null)
    .map(([label]) => label);
}

/**
 * Attach (or create) a per-agent forum topic and remember it on the session.
 * @param {import("./sessions.js").SessionManager} sessions
 * @param {{ sessionId: string, agentId: string, project: string, name?: string, telegramThreadId?: number|null }} detail
 */
async function attachAgentTopic(sessions, detail) {
  if (detail.telegramThreadId) {
    return {
      threadId: detail.telegramThreadId,
      name: detail.name,
      reused: true,
    };
  }
  const binding = await ensureAgentTelegramTopic(detail);
  if (!binding) return null;
  sessions.setTelegramThreadId(detail.sessionId, binding.threadId);
  return { threadId: binding.threadId, name: binding.name, reused: false };
}

async function reply(threadId, text, { rich = false } = {}) {
  if (rich) {
    const { html, plainFallback } = buildTelegramRichContent(text);
    await sendTelegramRichMessage({
      html,
      plainFallback,
      messageThreadId: threadId ?? undefined,
    });
    return;
  }
  await sendTelegramMessage({
    text,
    messageThreadId: threadId ?? undefined,
  });
}

function helpText() {
  const projects = projectTopicNames();
  const projectList = projects.length
    ? projects.map((p) => `**${p}**`).join(" / ")
    : "**app** / **www** / **admin** / **email**…";
  const lines = [
    "**Cursor Bridge commands**",
    "",
    ...TELEGRAM_BOT_COMMANDS.map((c) => `\`/${c.command}\` — ${c.description}`),
    "",
    "Also accepted: `/phone on` · `/phone off`",
    "",
    `\`/phone_on\` mirrors **Cursor Agents** (Agents Window / local SDK) into Telegram topics and streams live runs.`,
    "",
    `You can also start from ${projectList} (or \`/new\`) — each new agent gets its own topic.`,
  ];
  return lines.join("\n");
}

async function buildStatusText(sessions) {
  const cursor = await checkCursorConnectivity();
  const phone = getPhoneModeState();
  const list = sessions.list();
  const active = sessions.countActiveRuns();
  const lines = [
    `**cursor-bridge** \`v${VERSION}\``,
    "",
    `phone: **${phone.phoneMode ? "ON" : "OFF"}**`,
    `cursor: **${cursor.ready ? "ready" : cursor.reason || "not ready"}**`,
    `sessions: **${list.length}** · active runs: **${active}**`,
  ];
  if (list.length) {
    lines.push("");
    for (const s of list.slice(0, 12)) {
      const mark = s.runActive ? "▶" : "·";
      lines.push(
        `${mark} \`${s.project}\` ${s.name || s.agentId.slice(0, 8)} [${s.runStatus}]`,
      );
    }
  }
  lines.push("");
  const mirror = getIdeMirrorStatus();
  lines.push(
    `ide mirror: **${mirror.running ? "ON" : "OFF"}**${mirror.streamingRuns ? ` · streaming ${mirror.streamingRuns}` : ""}`,
  );
  lines.push("");
  lines.push("Commands: `/phone_on` · `/phone_off` · `/status` · `/stop` · `/new` · `/help`");
  return lines.join("\n");
}

/**
 * Run a chat turn for a project and stream assistant text to Telegram.
 * Spawns a per-agent forum topic when starting a new session (or /new).
 *
 * @param {import("./sessions.js").SessionManager} sessions
 * @param {{
 *   project: string,
 *   prompt: string,
 *   messageThreadId: number|null,
 *   forceNew?: boolean,
 *   sessionId?: string|null,
 *   announceFromThreadId?: number|null,
 * }} opts
 */
async function runProjectPrompt(sessions, opts) {
  const {
    project,
    prompt,
    messageThreadId,
    forceNew = false,
    sessionId = null,
    announceFromThreadId = null,
  } = opts;

  let detail = null;
  if (sessionId) {
    detail = sessions.getDetail(sessionId);
  } else if (!forceNew) {
    detail = sessions.findLatestForProject(project);
  }

  if (detail && detail.runActive) {
    await reply(
      messageThreadId,
      `session busy (${detail.name || detail.sessionId}). /stop then retry, or wait.`,
    );
    return;
  }

  const createdFresh = !detail;
  if (!detail) {
    detail = await sessions.create({ project, model: "default" });
  }

  const id = detail.sessionId;
  let record = sessions.require(id);

  if (!record.namedFromPrompt) {
    sessions.setInterimName(id, nameFromPrompt(prompt));
    record = sessions.require(id);
  }

  // Per-agent Telegram topic: create on new agents; reuse when bound.
  let streamThreadId = messageThreadId;
  const topic = await attachAgentTopic(sessions, {
    ...detail,
    name: record.name,
    telegramThreadId: record.telegramThreadId,
  });
  if (topic?.threadId != null) {
    streamThreadId = topic.threadId;
    if (
      announceFromThreadId != null &&
      announceFromThreadId !== topic.threadId &&
      (createdFresh || forceNew || !topic.reused)
    ) {
      await reply(
        announceFromThreadId,
        `Spawned agent topic «${topic.name}» — streaming there.`,
      );
    }
  }

  const streamer = createDraftStreamer({ messageThreadId: streamThreadId });
  let claimedRunId = null;

  sessions.notePrompt(id, prompt);
  sessions.startRunEvents(id);

  const publish = (event) => sessions.publishEvent(id, event);

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
      message: "Run started (telegram)",
    }),
  );
  publish(
    createSseEvent("user", id, { text: prompt, source: "telegram" }),
  );

  try {
    await streamer.noteStarted();

    const abortController = new AbortController();
    const run = await record.agent.send(prompt);
    sessions.setActiveRun(id, run, abortController);

    claimedRunId = run?.id || run?.runId || `tg-${id}`;
    claimIdeMirrorRun(record.agentId, claimedRunId);

    const outcome = await consumeRun(run, {
      sessionId: id,
      signal: abortController.signal,
      onEvent: (event) => {
        publish(event);
        if (event.type === "assistant" && event.text) {
          sessions.noteAssistantText(id, event.text);
          streamer.push(event.text);
        }
      },
    });

    if (outcome.cancelled) {
      sessions.clearActiveRun(id, "cancelled");
      await streamer.finalize();
      await reply(streamThreadId, "cancelled");
    } else if (outcome.failed) {
      sessions.clearActiveRun(id, "error");
      await streamer.fail("run failed");
    } else {
      sessions.clearActiveRun(id, "idle");
      await streamer.finalize();

      if (sessions.scheduleNaming(id)) {
        const snapshot = sessions.get(id);
        if (snapshot) {
          void finalizeAgentName({
            sessions,
            sessionId: id,
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
    sessions.clearActiveRun(id, "error");
    await streamer.abort(
      `error: ${err instanceof Error ? err.message : "run failed"}`,
    );
    throw err;
  } finally {
    if (claimedRunId) {
      releaseIdeMirrorRun(record.agentId, claimedRunId);
    }
    // Avoid re-mirroring the Telegram turn via IDE history poll.
    void catchUpAgentHistory(record.agentId, record.project);
  }
}

function enqueueProjectRun(project, task) {
  const prev = projectRunLocks.get(project) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(task)
    .finally(() => {
      if (projectRunLocks.get(project) === next) {
        projectRunLocks.delete(project);
      }
    });
  projectRunLocks.set(project, next);
  return next;
}

/**
 * @param {import("./sessions.js").SessionManager} sessions
 * @param {{
 *   text: string,
 *   threadId: number|null,
 *   resolved: ReturnType<typeof resolveTelegramThread>,
 * }} msg
 */
async function handleCommand(sessions, msg) {
  const { text, threadId, resolved } = msg;
  // Menu picks arrive as /status@cursor_bridge_mbp_bot — strip @bot suffix.
  const trimmed = text
    .trim()
    .replace(/^(\/[a-zA-Z0-9_]+)@[A-Za-z0-9_]+/, "$1");
  const lower = trimmed.toLowerCase();
  const [cmd, ...argParts] = lower.split(/\s+/);
  const args = argParts.join(" ").trim();

  const projectFromThread =
    resolved.kind === "project" || resolved.kind === "agent"
      ? resolved.label
      : null;

  if (
    cmd === "/phone_on" ||
    cmd === "/phoneon" ||
    (cmd === "/phone" && args === "on")
  ) {
    setPhoneMode(true);
    await reply(
      threadId,
      "phone mode ON — mirroring Cursor Agents into Telegram…",
    );
    try {
      const result = await startIdeAgentMirror(sessions);
      const lines = [
        `Mirroring **${result.mirrored}** recent/running agent(s).`,
        "Each agent has (or gets) its own forum topic; live runs stream there.",
        "Reply in an agent topic to send a follow-up into that Cursor agent.",
      ];
      if (result.agents?.length) {
        lines.push("");
        for (const a of result.agents.slice(0, 12)) {
          lines.push(
            `· \`${a.project}\` ${a.name} [${a.status}]`,
          );
        }
      }
      await reply(threadId, lines.join("\n"), { rich: true });
    } catch (err) {
      await reply(
        threadId,
        `mirror started with errors: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
    return;
  }
  if (cmd === "/phone" && args === "") {
    await reply(threadId, await buildStatusText(sessions));
    return;
  }
  if (
    cmd === "/phone_off" ||
    cmd === "/phoneoff" ||
    (cmd === "/phone" && args === "off")
  ) {
    setPhoneMode(false);
    stopIdeAgentMirror();
    await reply(threadId, "phone mode OFF — IDE mirror stopped");
    return;
  }
  if (cmd === "/status" || (cmd === "/phone" && args === "")) {
    await reply(threadId, await buildStatusText(sessions), { rich: true });
    return;
  }
  if (cmd === "/help" || cmd === "/start") {
    await reply(threadId, helpText(), { rich: true });
    return;
  }
  if (cmd === "/stop") {
    let targets;
    if (resolved.kind === "agent" && resolved.binding?.sessionId) {
      const detail = sessions.getDetail(resolved.binding.sessionId);
      targets =
        detail?.runActive
          ? [detail]
          : sessions.listActiveRuns(resolved.binding.project);
    } else if (projectFromThread) {
      targets = sessions.listActiveRuns(projectFromThread);
    } else {
      targets = sessions.listActiveRuns();
    }
    if (!targets.length) {
      await reply(threadId, "no active runs");
      return;
    }
    for (const s of targets) {
      try {
        await sessions.cancel(s.sessionId);
      } catch {
        // ignore
      }
    }
    await reply(
      threadId,
      `stopped ${targets.length} run(s)${projectFromThread ? ` for ${projectFromThread}` : ""}`,
    );
    return;
  }
  if (cmd === "/new") {
    const project =
      resolved.kind === "project"
        ? resolved.label
        : resolved.kind === "agent"
          ? resolved.binding?.project
          : null;
    if (!project) {
      await reply(
        threadId,
        `use /new inside a project topic (${projectTopicNames().join(", ") || "app, www, …"})`,
      );
      return;
    }
    if (!isPhoneModeOn()) {
      await reply(threadId, "phone mode off — send /phone_on first");
      return;
    }
    const existing = sessions.findLatestForProject(project);
    if (existing) {
      try {
        await sessions.close(existing.sessionId);
      } catch {
        // ignore
      }
    }
    const created = await sessions.create({ project, model: "default" });
    const topic = await attachAgentTopic(sessions, created);
    if (topic?.threadId != null) {
      await reply(
        threadId,
        `new ${project} agent → «${topic.name}»\nSend prompts in that topic.`,
      );
    } else {
      await reply(
        threadId,
        `new ${project} session ${created.sessionId.slice(0, 8)}… — send a prompt`,
      );
    }
    return;
  }

  // Plain text prompt
  if (resolved.kind === "status" || resolved.kind === "unknown") {
    if (resolved.kind === "status" || resolved.label === "general") {
      await reply(
        threadId,
        `Status topic: /phone_on · /phone_off · /status · /stop\n/phone_on mirrors Cursor Agents → Telegram topics.\nOr prompt in project topics (${projectTopicNames().join(", ") || "app, www, …"}).`,
      );
      return;
    }
    await reply(
      threadId,
      "unknown topic — use a project topic, /phone_on (IDE mirror), or /new",
    );
    return;
  }

  if (!isPhoneModeOn()) {
    await reply(
      threadId,
      "phone mode off — send /phone_on to mirror Cursor Agents + enable prompts",
    );
    return;
  }

  const project = projectFromThread;
  const boundSessionId =
    resolved.kind === "agent" ? resolved.binding?.sessionId : null;

  void enqueueProjectRun(project, () =>
    runProjectPrompt(sessions, {
      project,
      prompt: trimmed,
      messageThreadId: threadId,
      sessionId: boundSessionId,
      // From a static project topic, announce + stream into a fresh agent topic.
      announceFromThreadId:
        resolved.kind === "project" ? threadId : null,
      forceNew: false,
    }),
  ).catch(async (err) => {
    console.error("[telegram] prompt failed:", err);
    await reply(
      threadId,
      `error: ${err instanceof Error ? err.message : "failed"}`,
    ).catch(() => {});
  });
}

/**
 * Express handler for Telegram webhook updates.
 * @param {import("./sessions.js").SessionManager} sessions
 */
export function createTelegramWebhookHandler(sessions) {
  return async function handleTelegramWebhook(req, res) {
    if (!isTelegramWebhookConfigured()) {
      res.status(503).json({
        error: "Telegram webhook not configured",
        code: "TELEGRAM_WEBHOOK_NOT_CONFIGURED",
      });
      return;
    }

    const expected = getTelegramWebhookSecret();
    const got = req.headers["x-telegram-bot-api-secret-token"];
    if (typeof got !== "string" || got !== expected) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    // Always ack quickly; process async.
    res.json({ ok: true });

    try {
      const update = req.body;
      const message = update?.message;
      if (!message || message.edit_date) return;

      const chatId = String(message.chat?.id ?? "");
      const expectedChat = getTelegramChatId();
      if (!expectedChat || chatId !== String(expectedChat)) return;

      if (message.from?.is_bot) return;

      const allowed = getTelegramAllowedUserIds();
      if (allowed.size > 0 && !allowed.has(Number(message.from?.id))) return;

      const text =
        typeof message.text === "string"
          ? message.text
          : typeof message.caption === "string"
            ? message.caption
            : "";
      if (!text.trim()) return;

      const threadId =
        message.message_thread_id != null
          ? Number(message.message_thread_id)
          : null;
      const resolved = resolveTelegramThread(threadId);

      await handleCommand(sessions, {
        text,
        threadId,
        resolved,
      });
    } catch (err) {
      console.error("[telegram] webhook handler error:", err);
    }
  };
}

export async function maybeSetTelegramWebhookOnBoot() {
  if (!isTelegramWebhookConfigured()) return;
  if (process.env.TELEGRAM_SET_WEBHOOK_ON_BOOT === "0") return;
  try {
    const { setTelegramWebhook, setTelegramBotCommands } = await import(
      "./telegram.js"
    );
    const result = await setTelegramWebhook();
    console.log(`📲 Telegram webhook set → ${result.url}`);
    const cmds = await setTelegramBotCommands();
    console.log(
      `⌨️  Telegram commands: ${cmds.commands.map((c) => "/" + c.command).join(" ")}`,
    );
  } catch (err) {
    console.warn(
      "[telegram] setWebhook/commands on boot failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

export { buildStatusText };
