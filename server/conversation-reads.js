import {
  deleteConversationRead,
  getConversationReadRow,
  listConversationReadRows,
  upsertConversationRead,
} from "./db.js";

/**
 * @typedef {{
 *   lastReadAt: number,
 *   lastCompletedAt: number,
 *   lastSortAt: number,
 * }} ConversationReadEntry
 */

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

function entryFromRow(row) {
  if (!row) return emptyEntry();
  return normalizeEntry({
    lastReadAt: row.last_read_at,
    lastCompletedAt: row.last_completed_at,
    lastSortAt: row.last_sort_at,
  });
}

/** @returns {Record<string, ConversationReadEntry>} */
export function listConversationReads() {
  return listConversationReadRows();
}

/**
 * @param {string} project
 * @param {string} agentId
 * @returns {ConversationReadEntry}
 */
export function getConversationRead(project, agentId) {
  const key = conversationKey(project, agentId);
  return entryFromRow(getConversationReadRow(key));
}

/**
 * Mark a conversation as read (opened / viewed).
 * @param {string} project
 * @param {string} agentId
 */
export function markConversationRead(project, agentId) {
  if (!project || !agentId) return getConversationRead(project, agentId);
  const key = conversationKey(project, agentId);
  const cur = entryFromRow(getConversationReadRow(key));
  const now = Date.now();
  cur.lastReadAt = Math.max(cur.lastReadAt, now);
  return upsertConversationRead(key, project, agentId, cur);
}

/**
 * Record that a run finished and the result may be unread.
 * @param {string} project
 * @param {string} agentId
 * @param {number} [at]
 */
export function markConversationCompleted(project, agentId, at = Date.now()) {
  if (!project || !agentId) return getConversationRead(project, agentId);
  const key = conversationKey(project, agentId);
  const cur = entryFromRow(getConversationReadRow(key));
  const ts = Number.isFinite(at) ? at : Date.now();
  cur.lastCompletedAt = Math.max(cur.lastCompletedAt, ts);
  cur.lastSortAt = Math.max(cur.lastSortAt, ts);
  return upsertConversationRead(key, project, agentId, cur);
}

/**
 * Bump stable list order without affecting unread (e.g. prompt sent / run started).
 * @param {string} project
 * @param {string} agentId
 * @param {number} [at]
 */
export function bumpConversationSort(project, agentId, at = Date.now()) {
  if (!project || !agentId) return getConversationRead(project, agentId);
  const key = conversationKey(project, agentId);
  const cur = entryFromRow(getConversationReadRow(key));
  const ts = Number.isFinite(at) ? at : Date.now();
  cur.lastSortAt = Math.max(cur.lastSortAt, ts);
  return upsertConversationRead(key, project, agentId, cur);
}

/**
 * @param {string} project
 * @param {string} agentId
 */
export function removeConversationRead(project, agentId) {
  if (!project || !agentId) return;
  deleteConversationRead(conversationKey(project, agentId));
}

/** Test helper */
export function _resetConversationReadsForTests(state = null) {
  // Clear via delete of known keys or replace from provided state.
  const current = listConversationReadRows();
  for (const key of Object.keys(current)) {
    deleteConversationRead(key);
  }
  if (!state?.byKey) return;
  for (const [key, value] of Object.entries(state.byKey)) {
    const colon = key.indexOf(":");
    const project = colon >= 0 ? key.slice(0, colon) : "";
    const agentId = colon >= 0 ? key.slice(colon + 1) : key;
    upsertConversationRead(key, project, agentId, normalizeEntry(value));
  }
}

export { conversationKey };
export const CONVERSATION_READS_FILE = "(sqlite:conversation_reads)";
