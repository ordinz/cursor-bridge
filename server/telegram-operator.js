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

/** @type {Map<string, Promise<void>>} */
const projectRunLocks = new Map();

function topicLabel(threadId) {
  const map = getTelegramTopicMap();
  if (threadId == null) return "general";
  for (const [label, id] of Object.entries(map)) {
    if (id != null && id === threadId) return label;
  }
  return null;
}

function projectForTopic(label) {
  if (!label || label === "status" || label === "general") return null;
  return label;
}

function projectTopicNames() {
  const map = getTelegramTopicMap();
  return Object.entries(map)
    .filter(([label, id]) => label !== "status" && id != null)
    .map(([label]) => label);
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
    `Prompts: type freely in ${projectList} topics while phone mode is on.`,
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
  lines.push("Commands: `/phone_on` · `/phone_off` · `/status` · `/stop` · `/new` · `/help`");
  return lines.join("\n");
}

/**
 * Run a chat turn for a project and stream assistant text to Telegram.
 * @param {import("./sessions.js").SessionManager} sessions
 * @param {{ project: string, prompt: string, messageThreadId: number|null, forceNew?: boolean }} opts
 */
async function runProjectPrompt(sessions, opts) {
  const { project, prompt, messageThreadId, forceNew = false } = opts;
  const streamer = createDraftStreamer({ messageThreadId });

  let detail = forceNew ? null : sessions.findLatestForProject(project);
  if (detail && detail.runActive) {
    await reply(
      messageThreadId,
      `session busy (${detail.name || detail.sessionId}). /stop then retry, or wait.`,
    );
    return;
  }

  if (!detail) {
    detail = await sessions.create({ project, model: "default" });
  }

  const id = detail.sessionId;
  let record = sessions.require(id);

  if (!record.namedFromPrompt) {
    sessions.setInterimName(id, nameFromPrompt(prompt));
    record = sessions.require(id);
  }

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

  await streamer.noteStarted();

  const abortController = new AbortController();
  const run = await record.agent.send(prompt);
  sessions.setActiveRun(id, run, abortController);

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
    await reply(messageThreadId, "cancelled");
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
 * @param {{ text: string, threadId: number|null, topic: string|null }} msg
 */
async function handleCommand(sessions, msg) {
  const { text, threadId, topic } = msg;
  // Menu picks arrive as /status@cursor_bridge_mbp_bot — strip @bot suffix.
  const trimmed = text
    .trim()
    .replace(/^(\/[a-zA-Z0-9_]+)@[A-Za-z0-9_]+/, "$1");
  const lower = trimmed.toLowerCase();
  const [cmd, ...argParts] = lower.split(/\s+/);
  const args = argParts.join(" ").trim();

  if (
    cmd === "/phone_on" ||
    cmd === "/phoneon" ||
    (cmd === "/phone" && args === "on")
  ) {
    setPhoneMode(true);
    await reply(threadId, "phone mode ON — prompts in app/www will run + stream here");
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
    await reply(threadId, "phone mode OFF — laptop work stays quiet");
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
    const project = projectForTopic(topic);
    const targets = project
      ? sessions.listActiveRuns(project)
      : sessions.listActiveRuns();
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
      `stopped ${targets.length} run(s)${project ? ` for ${project}` : ""}`,
    );
    return;
  }
  if (cmd === "/new") {
    const project = projectForTopic(topic);
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
    await reply(
      threadId,
      `new ${project} session ${created.sessionId.slice(0, 8)}… — send a prompt`,
    );
    return;
  }

  // Plain text prompt
  const project = projectForTopic(topic);
  if (!project) {
    if (topic === "status" || topic == null) {
      await reply(
        threadId,
        `Status topic: /phone_on · /phone_off · /status · /stop\nPrompts go in project topics (${projectTopicNames().join(", ") || "app, www, …"}).`,
      );
      return;
    }
    await reply(threadId, "unknown topic — configure TELEGRAM_TOPIC_* env vars");
    return;
  }

  if (!isPhoneModeOn()) {
    await reply(threadId, "phone mode off — send /phone_on to sync from this phone");
    return;
  }

  void enqueueProjectRun(project, () =>
    runProjectPrompt(sessions, {
      project,
      prompt: trimmed,
      messageThreadId: threadId,
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
      const topic = topicLabel(threadId);

      await handleCommand(sessions, {
        text,
        threadId,
        topic,
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
