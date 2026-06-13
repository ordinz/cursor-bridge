import { writeSse } from "./stream.js";

const BUFFER_MAX = 200;

export class SessionEventHub {
  constructor() {
    /** @type {Map<string, Set<import("express").Response>>} */
    this.subscribers = new Map();
    /** @type {Map<string, object[]>} */
    this.buffers = new Map();
  }

  /** Clear replay buffer at the start of a new run. */
  startRun(sessionId) {
    this.buffers.set(sessionId, []);
  }

  /** @param {string} sessionId @param {object} event */
  record(sessionId, event) {
    let buffer = this.buffers.get(sessionId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(sessionId, buffer);
    }
    buffer.push(event);
    if (buffer.length > BUFFER_MAX) {
      buffer.splice(0, buffer.length - BUFFER_MAX);
    }
  }

  /**
   * Record an event, write to the chat response (if any), and fan out to watchers.
   * @param {string} sessionId
   * @param {object} event
   * @param {import("express").Response} [chatRes]
   */
  publish(sessionId, event, chatRes) {
    this.record(sessionId, event);
    if (chatRes && !chatRes.writableEnded) {
      writeSse(chatRes, event);
    }
    const subs = this.subscribers.get(sessionId);
    if (!subs) return;
    for (const sub of subs) {
      if (sub === chatRes || sub.writableEnded) continue;
      writeSse(sub, event);
    }
  }

  /**
   * @param {string} sessionId
   * @param {import("express").Response} res
   * @param {{ replay?: boolean }} [options]
   */
  subscribe(sessionId, res, { replay = true } = {}) {
    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, new Set());
    }
    this.subscribers.get(sessionId).add(res);

    if (replay) {
      for (const event of this.buffers.get(sessionId) ?? []) {
        if (!res.writableEnded) {
          writeSse(res, event);
        }
      }
    }

    return () => {
      const subs = this.subscribers.get(sessionId);
      subs?.delete(res);
      if (subs?.size === 0) {
        this.subscribers.delete(sessionId);
      }
    };
  }

  removeSession(sessionId) {
    const subs = this.subscribers.get(sessionId);
    if (subs) {
      for (const res of subs) {
        if (!res.writableEnded) {
          res.end();
        }
      }
    }
    this.subscribers.delete(sessionId);
    this.buffers.delete(sessionId);
  }
}
