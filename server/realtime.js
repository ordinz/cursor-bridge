/**
 * Write-path realtime bus: after SQLite commits, fan out typed change envelopes.
 * Session conversation feed stays on SessionEventHub; this covers bridge sync.
 */

function sendWs(ws, event) {
  if (ws.readyState !== 1 /* OPEN */) return;
  try {
    ws.send(JSON.stringify(event));
  } catch {
    /* drop */
  }
}

export class RealtimeBus {
  constructor() {
    /** @type {Set<{ ws: import("ws").WebSocket, tables: Set<string>|null }>} */
    this.subscribers = new Set();
  }

  /**
   * @param {import("ws").WebSocket} ws
   * @param {{ tables?: string[]|null }} [options]
   */
  subscribe(ws, { tables = null } = {}) {
    const tableSet =
      tables && tables.length > 0 ? new Set(tables.map(String)) : null;
    const entry = { ws, tables: tableSet };
    this.subscribers.add(entry);
    return () => {
      this.subscribers.delete(entry);
    };
  }

  /**
   * @param {{
   *   table: string,
   *   op: "insert"|"update"|"delete",
   *   row?: object|null,
   *   key?: string|null,
   * }} change
   */
  emit(change) {
    const envelope = {
      type: "db.change",
      table: change.table,
      op: change.op,
      row: change.row ?? null,
      key: change.key ?? null,
      ts: Date.now(),
    };
    for (const sub of this.subscribers) {
      if (sub.tables && !sub.tables.has(change.table)) continue;
      sendWs(sub.ws, envelope);
    }
  }

  /** Close all bridge-sync sockets (shutdown). */
  closeAll() {
    for (const sub of this.subscribers) {
      try {
        sub.ws.close(1000, "bridge closing");
      } catch {
        /* ignore */
      }
    }
    this.subscribers.clear();
  }
}

/** @type {RealtimeBus|null} */
let shared = null;

export function getRealtimeBus() {
  if (!shared) shared = new RealtimeBus();
  return shared;
}

/** Test helper */
export function _resetRealtimeBusForTests() {
  if (shared) shared.closeAll();
  shared = null;
}
