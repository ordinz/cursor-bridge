import crypto from "crypto";
import {
  cancelQueuedItem,
  claimNextQueueItem,
  finishQueueItem,
  getQueueItem,
  insertQueueItem,
  listQueueItems,
  pruneFinishedQueueItems,
  queueRowToPublic,
  tryMarkSessionRunning,
} from "./db.js";

/**
 * Enqueue a prompt for later execution, or claim immediately if the session is idle.
 *
 * @param {{
 *   sessionId: string,
 *   project: string,
 *   prompt: string,
 *   images?: object[],
 *   includeDevLogs?: boolean,
 *   source?: string,
 *   allowOverlap?: boolean,
 * }} input
 * @returns {{
 *   mode: "immediate"|"queued",
 *   item: ReturnType<typeof queueRowToPublic>|null,
 *   reason?: string,
 * }}
 */
export function enqueueOrClaim(input) {
  const {
    sessionId,
    project,
    prompt,
    images = [],
    includeDevLogs = false,
    source = "api",
    allowOverlap = false,
  } = input;

  pruneFinishedQueueItems();

  if (!allowOverlap) {
    const immediate = tryMarkSessionRunning(sessionId, { allowOverlap: false });
    if (immediate.ok) {
      return { mode: "immediate", item: null };
    }
    if (immediate.reason === "missing") {
      return { mode: "queued", item: null, reason: "missing" };
    }
  } else {
    tryMarkSessionRunning(sessionId, { allowOverlap: true });
    return { mode: "immediate", item: null };
  }

  const id = crypto.randomUUID();
  const row = insertQueueItem({
    id,
    session_id: sessionId,
    project,
    prompt,
    images_json: images.length ? JSON.stringify(images) : null,
    include_dev_logs: includeDevLogs,
    source,
    allow_overlap: false,
    created_at: Date.now(),
  });

  return { mode: "queued", item: queueRowToPublic(row) };
}

/**
 * Claim next queued prompt for a session (after a run finishes).
 * @param {string} sessionId
 */
export function claimNextForSession(sessionId) {
  const row = claimNextQueueItem(sessionId);
  return queueRowToPublic(row);
}

export function markQueueDone(id) {
  return queueRowToPublic(finishQueueItem(id, "done"));
}

export function markQueueFailed(id, error) {
  return queueRowToPublic(
    finishQueueItem(id, "failed", error ? String(error) : null),
  );
}

export function cancelQueueItem(id) {
  return queueRowToPublic(cancelQueuedItem(id));
}

export function getQueue(id) {
  return queueRowToPublic(getQueueItem(id));
}

export function listQueue(opts = {}) {
  return listQueueItems(opts).map(queueRowToPublic);
}

/**
 * Count queued items waiting for a session.
 * @param {string} sessionId
 */
export function countQueuedForSession(sessionId) {
  return listQueueItems({ sessionId, status: "queued" }).length;
}
