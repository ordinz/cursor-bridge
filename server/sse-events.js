import { writeSse } from "./stream.js";

export function sseTimestamp() {
  return new Date().toISOString();
}

/** @param {string} type @param {string | null | undefined} sessionId @param {Record<string, unknown>} [fields] */
export function createSseEvent(type, sessionId, fields = {}) {
  return {
    type,
    sessionId: sessionId ?? null,
    timestamp: sseTimestamp(),
    ...fields,
  };
}

export function writeSseEvent(res, type, sessionId, fields = {}) {
  writeSse(res, createSseEvent(type, sessionId, fields));
}
