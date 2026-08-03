import { writeSse } from "./stream.js";

const BUFFER_MAX = 500;

function sendWs(ws, event) {
  if (ws.readyState !== 1 /* WebSocket.OPEN */) return;
  try {
    ws.send(JSON.stringify(event));
  } catch {
    // Drop on send failure; close handler will unsubscribe.
  }
}

export class SessionEventHub {
  constructor() {
    /** @type {Map<string, Set<import("express").Response>>} */
    this.subscribers = new Map();
    /** @type {Map<string, Set<import("ws").WebSocket>>} */
    this.wsSubscribers = new Map();
    /** @type {Map<string, object[]>} */
    this.buffers = new Map();
    /** @type {Map<string, number>} */
    this.nextSeq = new Map();
  }

  /** Clear replay buffer at the start of a new run. */
  startRun(sessionId) {
    this.buffers.set(sessionId, []);
  }

  /**
   * @param {string} sessionId
   * @param {object} event
   */
  record(sessionId, event) {
    const seq = (this.nextSeq.get(sessionId) ?? 0) + 1;
    this.nextSeq.set(sessionId, seq);
    const stamped = { ...event, seq };

    let buffer = this.buffers.get(sessionId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(sessionId, buffer);
    }
    buffer.push(stamped);
    if (buffer.length > BUFFER_MAX) {
      buffer.splice(0, buffer.length - BUFFER_MAX);
    }
    return stamped;
  }

  /**
   * Record an event, write to the chat response (if any), and fan out to watchers.
   * @param {string} sessionId
   * @param {object} event
   * @param {import("express").Response} [chatRes]
   */
  publish(sessionId, event, chatRes) {
    const stamped = this.record(sessionId, event);
    if (chatRes && !chatRes.writableEnded) {
      writeSse(chatRes, stamped);
    }

    const httpSubs = this.subscribers.get(sessionId);
    if (httpSubs) {
      for (const sub of httpSubs) {
        if (sub === chatRes || sub.writableEnded) continue;
        writeSse(sub, stamped);
      }
    }

    const wsSubs = this.wsSubscribers.get(sessionId);
    if (wsSubs) {
      for (const ws of wsSubs) {
        sendWs(ws, stamped);
      }
    }
  }

  /**
   * @param {string} sessionId
   * @param {import("express").Response} res
   * @param {{ replay?: boolean, afterSeq?: number }} [options]
   */
  subscribe(sessionId, res, { replay = true, afterSeq = 0 } = {}) {
    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, new Set());
    }
    this.subscribers.get(sessionId).add(res);

    if (replay) {
      for (const event of this.buffers.get(sessionId) ?? []) {
        if ((event.seq ?? 0) <= afterSeq) continue;
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

  /**
   * @param {string} sessionId
   * @param {import("ws").WebSocket} ws
   * @param {{ replay?: boolean, afterSeq?: number }} [options]
   */
  subscribeWs(sessionId, ws, { replay = true, afterSeq = 0 } = {}) {
    if (!this.wsSubscribers.has(sessionId)) {
      this.wsSubscribers.set(sessionId, new Set());
    }
    this.wsSubscribers.get(sessionId).add(ws);

    if (replay) {
      for (const event of this.buffers.get(sessionId) ?? []) {
        if ((event.seq ?? 0) <= afterSeq) continue;
        sendWs(ws, event);
      }
    }

    return () => {
      const subs = this.wsSubscribers.get(sessionId);
      subs?.delete(ws);
      if (subs?.size === 0) {
        this.wsSubscribers.delete(sessionId);
      }
    };
  }

  removeSession(sessionId) {
    const httpSubs = this.subscribers.get(sessionId);
    if (httpSubs) {
      for (const res of httpSubs) {
        if (!res.writableEnded) {
          res.end();
        }
      }
    }
    this.subscribers.delete(sessionId);

    const wsSubs = this.wsSubscribers.get(sessionId);
    if (wsSubs) {
      for (const ws of wsSubs) {
        try {
          ws.close(1000, "session closed");
        } catch {
          /* ignore */
        }
      }
    }
    this.wsSubscribers.delete(sessionId);
    this.buffers.delete(sessionId);
    this.nextSeq.delete(sessionId);
  }
}
