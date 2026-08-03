import fs from "fs";
import os from "os";
import path from "path";

const STATE_DIR = path.join(os.homedir(), ".cursor-bridge");
const STATE_FILE = path.resolve(
  process.env.CONVERSATION_READS_FILE ||
    path.join(STATE_DIR, "conversation-reads.json"),
);

/**
 * @typedef {{
 *   lastReadAt: number,
 *   lastCompletedAt: number,
 *   lastSortAt: number,
 * }} ConversationReadEntry
 */

/** @type {{ byKey: Record<string, ConversationReadEntry> } | null} */
let cached = null;

function conversationKey(project, agentId) {
  return `${String(project)}:${String(agentId)}`;
}

function emptyEntry() {
  return { lastReadAt: 0, lastCompletedAt: 0, lastSortAt: 0 };
}

function normalizeEntry(raw) {
  const base = emptyEntry();
  if (!raw || typeof raw !== "object") return base;
  return {
    lastReadAt:
      typeof raw.lastReadAt === "number" && Number.isFinite(raw.lastReadAt)
        ? raw.lastReadAt
        : 0,
    lastCompletedAt:
      typeof raw.lastCompletedAt === "number" &&
      Number.isFinite(raw.lastCompletedAt)
        ? raw.lastCompletedAt
        : 0,
    lastSortAt:
      typeof raw.lastSortAt === "number" && Number.isFinite(raw.lastSortAt)
        ? raw.lastSortAt
        : 0,
  };
}

function defaultState() {
  return { byKey: {} };
}

function readState() {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const byKey = {};
    if (parsed?.byKey && typeof parsed.byKey === "object") {
      for (const [key, value] of Object.entries(parsed.byKey)) {
        byKey[key] = normalizeEntry(value);
      }
    }
    cached = { byKey };
  } catch {
    cached = defaultState();
  }
  return cached;
}

function writeState(next) {
  cached = next;
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch (err) {
    console.warn(
      "[conversation-reads] failed to persist:",
      err instanceof Error ? err.message : err,
    );
  }
}

function touchEntry(project, agentId) {
  const state = readState();
  const key = conversationKey(project, agentId);
  const cur = state.byKey[key] ? { ...state.byKey[key] } : emptyEntry();
  return { state, key, cur };
}

/** @returns {Record<string, ConversationReadEntry>} */
export function listConversationReads() {
  return { ...readState().byKey };
}

/**
 * @param {string} project
 * @param {string} agentId
 * @returns {ConversationReadEntry}
 */
export function getConversationRead(project, agentId) {
  const key = conversationKey(project, agentId);
  return normalizeEntry(readState().byKey[key]);
}

/**
 * Mark a conversation as read (opened / viewed).
 * @param {string} project
 * @param {string} agentId
 */
export function markConversationRead(project, agentId) {
  if (!project || !agentId) return getConversationRead(project, agentId);
  const { state, key, cur } = touchEntry(project, agentId);
  const now = Date.now();
  cur.lastReadAt = Math.max(cur.lastReadAt, now);
  state.byKey[key] = cur;
  writeState({ byKey: { ...state.byKey } });
  return { ...cur };
}

/**
 * Record that a run finished and the result may be unread.
 * @param {string} project
 * @param {string} agentId
 * @param {number} [at]
 */
export function markConversationCompleted(project, agentId, at = Date.now()) {
  if (!project || !agentId) return getConversationRead(project, agentId);
  const { state, key, cur } = touchEntry(project, agentId);
  const ts = Number.isFinite(at) ? at : Date.now();
  cur.lastCompletedAt = Math.max(cur.lastCompletedAt, ts);
  cur.lastSortAt = Math.max(cur.lastSortAt, ts);
  state.byKey[key] = cur;
  writeState({ byKey: { ...state.byKey } });
  return { ...cur };
}

/**
 * Bump stable list order without affecting unread (e.g. prompt sent / run started).
 * @param {string} project
 * @param {string} agentId
 * @param {number} [at]
 */
export function bumpConversationSort(project, agentId, at = Date.now()) {
  if (!project || !agentId) return getConversationRead(project, agentId);
  const { state, key, cur } = touchEntry(project, agentId);
  const ts = Number.isFinite(at) ? at : Date.now();
  cur.lastSortAt = Math.max(cur.lastSortAt, ts);
  state.byKey[key] = cur;
  writeState({ byKey: { ...state.byKey } });
  return { ...cur };
}

/**
 * @param {string} project
 * @param {string} agentId
 */
export function removeConversationRead(project, agentId) {
  if (!project || !agentId) return;
  const state = readState();
  const key = conversationKey(project, agentId);
  if (!(key in state.byKey)) return;
  const next = { ...state.byKey };
  delete next[key];
  writeState({ byKey: next });
}

/** Test helper */
export function _resetConversationReadsForTests(state = null) {
  cached = state
    ? {
        byKey: Object.fromEntries(
          Object.entries(state.byKey || {}).map(([k, v]) => [
            k,
            normalizeEntry(v),
          ]),
        ),
      }
    : null;
}

export { conversationKey, STATE_FILE as CONVERSATION_READS_FILE };
