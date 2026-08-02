import { Agent } from "@cursor/sdk";
import { loadAgentHistory } from "./agent-history.js";
import { ENABLED_PROJECT_IDS, resolveProject } from "./projects.js";
import { createDraftStreamer } from "./telegram-draft.js";
import { isPhoneModeOn } from "./telegram-phone.js";
import {
  ensureAgentTelegramTopic,
  formatAgentTopicName,
  renameAgentTelegramTopic,
} from "./telegram-topics.js";
import { sendTelegramMessage } from "./telegram.js";
import fs from "fs";
import path from "path";

const POLL_MS = Number(process.env.TELEGRAM_IDE_MIRROR_POLL_MS ?? 4000);
const RECENT_MS = Number(
  process.env.TELEGRAM_IDE_MIRROR_RECENT_MS ?? 2 * 60 * 60 * 1000,
);
const MAX_AGENTS_PER_PROJECT = Number(
  process.env.TELEGRAM_IDE_MIRROR_MAX_PER_PROJECT ?? 12,
);
const BOOTSTRAP_ITEMS = 6;

const STATE_PATH = path.resolve(
  process.env.TELEGRAM_IDE_MIRROR_STORE ??
    path.join(
      process.env.HOME || "",
      ".cursor-bridge",
      "telegram-ide-mirror.json",
    ),
);

/** @type {ReturnType<typeof setInterval>|null} */
let pollTimer = null;
let generation = 0;
/** @type {Set<string>} */
const streamingRunIds = new Set();
/** @type {Set<string>} */
const mirroringAgentIds = new Set();

/** @type {{ seenByAgent: Record<string, string[]>, bootstrapped: Record<string, boolean> } | null} */
let stateCache = null;

function loadState() {
  if (stateCache) return stateCache;
  try {
    if (fs.existsSync(STATE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
      stateCache = {
        seenByAgent: raw.seenByAgent || {},
        bootstrapped: raw.bootstrapped || {},
      };
      return stateCache;
    }
  } catch (err) {
    console.warn("[ide-mirror] state load failed:", err?.message || err);
  }
  stateCache = { seenByAgent: {}, bootstrapped: {} };
  return stateCache;
}

function saveState() {
  const state = loadState();
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    // Cap seen ids per agent
    for (const [agentId, ids] of Object.entries(state.seenByAgent)) {
      if (ids.length > 400) {
        state.seenByAgent[agentId] = ids.slice(-300);
      }
    }
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn("[ide-mirror] state save failed:", err?.message || err);
  }
}

function markSeen(agentId, itemId) {
  const state = loadState();
  const list = state.seenByAgent[agentId] || [];
  if (!list.includes(itemId)) {
    list.push(itemId);
    state.seenByAgent[agentId] = list;
  }
}

function hasSeen(agentId, itemId) {
  const state = loadState();
  return (state.seenByAgent[agentId] || []).includes(itemId);
}

/**
 * Mark all current history items as seen so stream/Telegram turns
 * are not re-posted by the next poll.
 * @param {string} agentId
 * @param {string} project
 */
export async function catchUpAgentHistory(agentId, project) {
  if (!agentId) return;
  try {
    const items = await loadAgentHistory(agentId, project);
    for (const item of items) {
      if (item?.id) markSeen(agentId, item.id);
    }
    const state = loadState();
    state.bootstrapped[agentId] = true;
    saveState();
  } catch (err) {
    console.warn("[ide-mirror] catchUp failed:", err?.message || err);
  }
}

async function postFeedItem(threadId, item) {
  if (item.kind === "user") {
    await sendTelegramMessage({
      text: `👤 ${item.text}`.slice(0, 4000),
      messageThreadId: threadId,
    });
    return;
  }
  if (item.kind === "assistant") {
    await sendTelegramMessage({
      text: `🤖 ${item.text}`.slice(0, 4000),
      messageThreadId: threadId,
    });
  }
}

/**
 * @param {import("./sessions.js").SessionManager} sessions
 * @param {string} project
 * @param {object} info Agent.list item
 */
async function ensureSessionForIdeAgent(sessions, project, info) {
  const agentId = info.agentId;
  const existing = sessions.list().find((s) => s.agentId === agentId);
  if (existing) {
    return sessions.getDetail(existing.sessionId);
  }
  return sessions.resumeAgent({
    agentId,
    project,
    model: "default",
  });
}

async function syncHistory(agentId, project, threadId) {
  if (streamingRunIds.size && mirroringAgentIds.has(agentId)) {
    // Still allow history if not actively streaming this agent — check below
  }
  const streamingThis = [...streamingRunIds].some((id) =>
    id.startsWith(`${agentId}:`),
  );
  if (streamingThis) return { posted: 0, bootstrapped: true };

  const items = await loadAgentHistory(agentId, project);
  const textItems = items.filter(
    (i) => (i.kind === "user" || i.kind === "assistant") && i.text?.trim(),
  );
  const state = loadState();
  let posted = 0;

  if (!state.bootstrapped[agentId]) {
    const recent = textItems.slice(-BOOTSTRAP_ITEMS);
    if (recent.length) {
      await sendTelegramMessage({
        text: `📥 Syncing last ${recent.length} message(s) from Cursor…`,
        messageThreadId: threadId,
      }).catch(() => {});
    }
    for (const item of recent) {
      await postFeedItem(threadId, item);
      markSeen(agentId, item.id);
      posted++;
    }
    state.bootstrapped[agentId] = true;
    saveState();
    return { posted, bootstrapped: true };
  }

  for (const item of textItems) {
    if (hasSeen(agentId, item.id)) continue;
    await postFeedItem(threadId, item);
    markSeen(agentId, item.id);
    posted++;
  }
  if (posted) saveState();
  return { posted, bootstrapped: true };
}

/**
 * @param {import("./sessions.js").SessionManager} sessions
 * @param {object} detail session detail
 * @param {number} threadId
 */
async function maybeStreamActiveRun(sessions, detail, threadId) {
  const cwd = detail.cwd;
  const agentId = detail.agentId;
  let runs;
  try {
    runs = await Agent.listRuns(agentId, { cwd, limit: 8 });
  } catch (err) {
    console.warn("[ide-mirror] listRuns failed:", err?.message || err);
    return;
  }

  const active = (runs.items || []).find(
    (r) => (r.status || r.currentStatus) === "running",
  );
  if (!active?.id) return;

  const streamKey = `${agentId}:${active.id}`;
  if (streamingRunIds.has(streamKey)) return;
  streamingRunIds.add(streamKey);
  mirroringAgentIds.add(agentId);

  const streamer = createDraftStreamer({ messageThreadId: threadId });
  try {
    await streamer.noteStarted();
    const run =
      typeof active.stream === "function"
        ? active
        : await Agent.getRun(active.id, { cwd });

    for await (const event of run.stream()) {
      if (!isPhoneModeOn()) break;
      if (event.type !== "assistant") continue;
      const content = event.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type === "text" && block.text) {
          streamer.push(block.text);
        }
      }
    }
    await streamer.finalize();
    await catchUpAgentHistory(agentId, detail.project);
  } catch (err) {
    console.warn(
      "[ide-mirror] stream failed:",
      err?.message || err,
    );
    try {
      await streamer.fail?.(String(err?.message || "stream failed"));
    } catch {
      /* ignore */
    }
  } finally {
    streamingRunIds.delete(streamKey);
    mirroringAgentIds.delete(agentId);
  }
}

/**
 * @param {import("./sessions.js").SessionManager} sessions
 * @param {string} project
 * @param {object} info
 */
async function mirrorOneAgent(sessions, project, info) {
  const agentId = info.agentId;
  if (!agentId) return null;

  let detail;
  try {
    detail = await ensureSessionForIdeAgent(sessions, project, info);
  } catch (err) {
    console.warn(
      `[ide-mirror] resume ${agentId.slice(0, 12)} failed:`,
      err?.message || err,
    );
    return null;
  }

  const displayName = info.name || detail.name || "Agent";

  const binding = await ensureAgentTelegramTopic({
    sessionId: detail.sessionId,
    agentId,
    project,
    name: displayName,
  });
  if (!binding) return null;

  sessions.setTelegramThreadId(detail.sessionId, binding.threadId);

  const expectedTitle = formatAgentTopicName(project, displayName);
  if (binding.name !== expectedTitle) {
    await renameAgentTelegramTopic(detail.sessionId, project, displayName);
  }

  await syncHistory(agentId, project, binding.threadId);

  if (info.status === "running") {
    // Fire-and-forget stream so poll loop can continue
    void maybeStreamActiveRun(sessions, detail, binding.threadId);
  }

  return {
    agentId,
    project,
    name: displayName,
    status: info.status,
    threadId: binding.threadId,
  };
}

function isRecentEnough(info, now) {
  if (info.status === "running") return true;
  const ts = Number(info.lastModified || info.createdAt || 0);
  if (!ts) return false;
  return now - ts <= RECENT_MS;
}

/**
 * @param {import("./sessions.js").SessionManager} sessions
 * @param {string} project
 */
async function mirrorProject(sessions, project) {
  let cwd;
  try {
    cwd = resolveProject(project);
  } catch {
    return [];
  }

  let listed;
  try {
    listed = await Agent.list({
      runtime: "local",
      cwd,
      limit: 40,
    });
  } catch (err) {
    console.warn(`[ide-mirror] list ${project}:`, err?.message || err);
    return [];
  }

  const now = Date.now();
  const candidates = (listed.items || [])
    .filter((a) => a?.agentId && !a.archived && isRecentEnough(a, now))
    .sort(
      (a, b) =>
        Number(b.lastModified || b.createdAt || 0) -
        Number(a.lastModified || a.createdAt || 0),
    )
    .slice(0, MAX_AGENTS_PER_PROJECT);

  const mirrored = [];
  for (const info of candidates) {
    if (!isPhoneModeOn()) break;
    const row = await mirrorOneAgent(sessions, project, info);
    if (row) mirrored.push(row);
  }
  return mirrored;
}

async function tick(sessions, gen) {
  if (!isPhoneModeOn() || gen !== generation) return;
  for (const project of ENABLED_PROJECT_IDS) {
    if (!isPhoneModeOn() || gen !== generation) return;
    try {
      await mirrorProject(sessions, project);
    } catch (err) {
      console.warn(`[ide-mirror] ${project}:`, err?.message || err);
    }
  }
}

/**
 * Start polling Cursor local agents → Telegram topics.
 * @param {import("./sessions.js").SessionManager} sessions
 * @returns {Promise<{ mirrored: number }>}
 */
export async function startIdeAgentMirror(sessions) {
  stopIdeAgentMirror();
  const gen = ++generation;

  // Immediate first pass so /phone_on can report counts
  let mirrored = [];
  for (const project of ENABLED_PROJECT_IDS) {
    try {
      const rows = await mirrorProject(sessions, project);
      mirrored = mirrored.concat(rows);
    } catch (err) {
      console.warn(`[ide-mirror] ${project}:`, err?.message || err);
    }
  }

  pollTimer = setInterval(() => {
    void tick(sessions, gen);
  }, POLL_MS);
  if (typeof pollTimer.unref === "function") pollTimer.unref();

  console.log(
    `📲 IDE agent mirror on — ${mirrored.length} agent(s), poll ${POLL_MS}ms`,
  );
  return { mirrored: mirrored.length, agents: mirrored };
}

export function stopIdeAgentMirror() {
  generation += 1;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  streamingRunIds.clear();
  mirroringAgentIds.clear();
  console.log("📲 IDE agent mirror off");
}

export function getIdeMirrorStatus() {
  return {
    running: pollTimer != null,
    streamingRuns: streamingRunIds.size,
    pollMs: POLL_MS,
  };
}

/** Test helper */
export function _resetIdeMirrorStateForTests() {
  stopIdeAgentMirror();
  stateCache = { seenByAgent: {}, bootstrapped: {} };
}
