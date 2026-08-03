import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { getRealtimeBus } from "./realtime.js";

const DEFAULT_DIR = path.join(os.homedir(), ".cursor-bridge");
const EVENTS_KEEP_PER_SESSION = Number(
  process.env.BRIDGE_EVENTS_KEEP ?? 5000,
);
const QUEUE_DONE_TTL_MS = Number(
  process.env.BRIDGE_QUEUE_TTL_MS ?? 7 * 24 * 60 * 60 * 1000,
);

/** @type {import("better-sqlite3").Database | null} */
let db = null;

export function getBridgeDbPath() {
  return path.resolve(
    process.env.BRIDGE_DB_PATH || path.join(DEFAULT_DIR, "bridge.db"),
  );
}

export function getDb() {
  if (!db) {
    openBridgeDb();
  }
  return db;
}

/**
 * Open (or reopen) the bridge SQLite database and run migrations.
 * @param {{ path?: string, migrateJson?: boolean }} [opts]
 */
export function openBridgeDb(opts = {}) {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
  }

  const dbPath = path.resolve(opts.path || getBridgeDbPath());
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);

  if (opts.migrateJson !== false) {
    migrateJsonStores(db);
  }

  return db;
}

export function closeBridgeDb() {
  if (!db) return;
  try {
    db.close();
  } catch {
    /* ignore */
  }
  db = null;
}

/** @param {import("better-sqlite3").Database} database */
function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      project TEXT NOT NULL,
      cwd TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'default',
      mode TEXT NOT NULL DEFAULT 'agent',
      name TEXT,
      named_from_prompt INTEGER NOT NULL DEFAULT 0,
      telegram_thread_id INTEGER,
      run_status TEXT NOT NULL DEFAULT 'idle',
      last_prompt TEXT,
      last_assistant_snippet TEXT,
      created_at INTEGER NOT NULL,
      last_activity_at INTEGER NOT NULL,
      list_activity_at INTEGER NOT NULL DEFAULT 0,
      closed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project, last_activity_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_open ON sessions(closed_at, last_activity_at DESC);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(session_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, seq);

    CREATE TABLE IF NOT EXISTS prompt_queue (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      prompt TEXT NOT NULL,
      images_json TEXT,
      include_dev_logs INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'api',
      allow_overlap INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      error TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_queue_session_status
      ON prompt_queue(session_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_queue_project_status
      ON prompt_queue(project, status, created_at);

    CREATE TABLE IF NOT EXISTS conversation_reads (
      key TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      last_read_at INTEGER NOT NULL DEFAULT 0,
      last_completed_at INTEGER NOT NULL DEFAULT 0,
      last_sort_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS telegram_topics (
      thread_id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      project TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tg_topics_session ON telegram_topics(session_id);
    CREATE INDEX IF NOT EXISTS idx_tg_topics_agent ON telegram_topics(agent_id);

    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  database
    .prepare(
      `INSERT INTO meta(key, value) VALUES('schema_version', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run();
}

function emitChange(table, op, row, key = null) {
  try {
    getRealtimeBus().emit({ table, op, row, key });
  } catch {
    /* bus may not matter in tests */
  }
}

// ── sessions ──────────────────────────────────────────────────────────────

/**
 * @param {object} row
 */
export function upsertSessionRow(row) {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO sessions (
        session_id, agent_id, project, cwd, model, mode, name,
        named_from_prompt, telegram_thread_id, run_status,
        last_prompt, last_assistant_snippet,
        created_at, last_activity_at, list_activity_at, closed_at
      ) VALUES (
        @session_id, @agent_id, @project, @cwd, @model, @mode, @name,
        @named_from_prompt, @telegram_thread_id, @run_status,
        @last_prompt, @last_assistant_snippet,
        @created_at, @last_activity_at, @list_activity_at, @closed_at
      )
      ON CONFLICT(session_id) DO UPDATE SET
        agent_id = excluded.agent_id,
        project = excluded.project,
        cwd = excluded.cwd,
        model = excluded.model,
        mode = excluded.mode,
        name = excluded.name,
        named_from_prompt = excluded.named_from_prompt,
        telegram_thread_id = excluded.telegram_thread_id,
        run_status = excluded.run_status,
        last_prompt = excluded.last_prompt,
        last_assistant_snippet = excluded.last_assistant_snippet,
        last_activity_at = excluded.last_activity_at,
        list_activity_at = excluded.list_activity_at,
        closed_at = excluded.closed_at`,
    )
    .run({
      session_id: row.session_id,
      agent_id: row.agent_id,
      project: row.project,
      cwd: row.cwd,
      model: row.model ?? "default",
      mode: row.mode ?? "agent",
      name: row.name ?? null,
      named_from_prompt: row.named_from_prompt ? 1 : 0,
      telegram_thread_id: row.telegram_thread_id ?? null,
      run_status: row.run_status ?? "idle",
      last_prompt: row.last_prompt ?? null,
      last_assistant_snippet: row.last_assistant_snippet ?? null,
      created_at: row.created_at,
      last_activity_at: row.last_activity_at,
      list_activity_at: row.list_activity_at ?? 0,
      closed_at: row.closed_at ?? null,
    });

  const saved = getSessionRow(row.session_id);
  emitChange("sessions", "update", sessionRowToPublic(saved), row.session_id);
  return saved;
}

export function getSessionRow(sessionId) {
  return (
    getDb()
      .prepare(`SELECT * FROM sessions WHERE session_id = ?`)
      .get(sessionId) ?? null
  );
}

export function getOpenSessionByAgentId(agentId) {
  return (
    getDb()
      .prepare(
        `SELECT * FROM sessions
         WHERE agent_id = ? AND closed_at IS NULL
         ORDER BY last_activity_at DESC LIMIT 1`,
      )
      .get(agentId) ?? null
  );
}

export function listOpenSessionRows({ limit = 200 } = {}) {
  return getDb()
    .prepare(
      `SELECT * FROM sessions
       WHERE closed_at IS NULL
       ORDER BY last_activity_at DESC
       LIMIT ?`,
    )
    .all(limit);
}

export function markSessionClosed(sessionId, at = Date.now()) {
  getDb()
    .prepare(
      `UPDATE sessions SET closed_at = ?, run_status = CASE
         WHEN run_status = 'running' THEN 'idle' ELSE run_status END,
         last_activity_at = ?
       WHERE session_id = ?`,
    )
    .run(at, at, sessionId);
  const saved = getSessionRow(sessionId);
  if (saved) {
    emitChange("sessions", "update", sessionRowToPublic(saved), sessionId);
  }
  return saved;
}

export function sessionRowToPublic(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    agentId: row.agent_id,
    project: row.project,
    cwd: row.cwd,
    model: row.model,
    mode: row.mode === "plan" ? "plan" : "agent",
    name: row.name,
    telegramThreadId: row.telegram_thread_id,
    runStatus: row.run_status,
    runActive: row.run_status === "running",
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    listActivityAt: row.list_activity_at || 0,
    lastPrompt: row.last_prompt,
    lastAssistantSnippet: row.last_assistant_snippet,
    namedFromPrompt: Boolean(row.named_from_prompt),
    closedAt: row.closed_at,
  };
}

/**
 * Persist a live SessionRecord shape into sessions table.
 * @param {object} record
 * @param {{ closedAt?: number|null }} [opts]
 */
export function persistSessionRecord(record, opts = {}) {
  return upsertSessionRow({
    session_id: record.sessionId,
    agent_id: record.agentId,
    project: record.project,
    cwd: record.cwd,
    model: record.model,
    mode: record.mode === "plan" ? "plan" : "agent",
    name: record.name,
    named_from_prompt: Boolean(record.namedFromPrompt),
    telegram_thread_id: record.telegramThreadId ?? null,
    run_status: record.runStatus,
    last_prompt: record.lastPrompt,
    last_assistant_snippet: record.lastAssistantSnippet,
    created_at: record.createdAt,
    last_activity_at: record.lastActivityAt,
    list_activity_at: record.listActivityAt || 0,
    closed_at: opts.closedAt === undefined ? null : opts.closedAt,
  });
}

// ── events ────────────────────────────────────────────────────────────────

export function appendEvent(sessionId, event) {
  const database = getDb();
  const now = Date.now();
  const tx = database.transaction(() => {
    const row = database
      .prepare(
        `SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM events WHERE session_id = ?`,
      )
      .get(sessionId);
    const seq = (row?.maxSeq ?? 0) + 1;
    const stamped = { ...event, seq };
    database
      .prepare(
        `INSERT INTO events (session_id, seq, type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        seq,
        String(event.type || "unknown"),
        JSON.stringify(stamped),
        now,
      );

    // Prune old events for this session
    database
      .prepare(
        `DELETE FROM events
         WHERE session_id = ?
           AND id NOT IN (
             SELECT id FROM events
             WHERE session_id = ?
             ORDER BY seq DESC
             LIMIT ?
           )`,
      )
      .run(sessionId, sessionId, EVENTS_KEEP_PER_SESSION);

    return stamped;
  });
  return tx();
}

export function listEventsAfter(sessionId, afterSeq = 0, { limit = 5000 } = {}) {
  const rows = getDb()
    .prepare(
      `SELECT payload_json FROM events
       WHERE session_id = ? AND seq > ?
       ORDER BY seq ASC
       LIMIT ?`,
    )
    .all(sessionId, afterSeq, limit);
  return rows.map((r) => {
    try {
      return JSON.parse(r.payload_json);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

export function getMaxEventSeq(sessionId) {
  const row = getDb()
    .prepare(`SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM events WHERE session_id = ?`)
    .get(sessionId);
  return row?.maxSeq ?? 0;
}

export function deleteEventsForSession(sessionId) {
  getDb().prepare(`DELETE FROM events WHERE session_id = ?`).run(sessionId);
}

// ── prompt queue ──────────────────────────────────────────────────────────

/**
 * @param {object} item
 */
export function insertQueueItem(item) {
  getDb()
    .prepare(
      `INSERT INTO prompt_queue (
        id, session_id, project, prompt, images_json, include_dev_logs,
        source, allow_overlap, status, created_at
      ) VALUES (
        @id, @session_id, @project, @prompt, @images_json, @include_dev_logs,
        @source, @allow_overlap, 'queued', @created_at
      )`,
    )
    .run({
      id: item.id,
      session_id: item.session_id,
      project: item.project,
      prompt: item.prompt,
      images_json: item.images_json ?? null,
      include_dev_logs: item.include_dev_logs ? 1 : 0,
      source: item.source ?? "api",
      allow_overlap: item.allow_overlap ? 1 : 0,
      created_at: item.created_at ?? Date.now(),
    });
  const saved = getQueueItem(item.id);
  emitChange("prompt_queue", "insert", queueRowToPublic(saved), item.id);
  return saved;
}

export function getQueueItem(id) {
  return (
    getDb().prepare(`SELECT * FROM prompt_queue WHERE id = ?`).get(id) ?? null
  );
}

export function listQueueItems({
  sessionId = null,
  project = null,
  status = null,
  limit = 100,
} = {}) {
  const clauses = [];
  const params = [];
  if (sessionId) {
    clauses.push("session_id = ?");
    params.push(sessionId);
  }
  if (project) {
    clauses.push("project = ?");
    params.push(project);
  }
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);
  return getDb()
    .prepare(
      `SELECT * FROM prompt_queue ${where} ORDER BY created_at ASC LIMIT ?`,
    )
    .all(...params);
}

/**
 * Atomically claim the next queued item for a session if the session is idle.
 * Sets session run_status=running and queue status=running.
 * @returns {object|null} claimed queue row
 */
export function claimNextQueueItem(sessionId) {
  const database = getDb();
  const tx = database.transaction(() => {
    const session = database
      .prepare(`SELECT * FROM sessions WHERE session_id = ?`)
      .get(sessionId);
    if (!session || session.closed_at != null) return null;
    if (session.run_status === "running") return null;

    const item = database
      .prepare(
        `SELECT * FROM prompt_queue
         WHERE session_id = ? AND status = 'queued'
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(sessionId);
    if (!item) return null;

    const now = Date.now();
    database
      .prepare(
        `UPDATE prompt_queue SET status = 'running', started_at = ? WHERE id = ?`,
      )
      .run(now, item.id);
    database
      .prepare(
        `UPDATE sessions SET run_status = 'running', last_activity_at = ?, list_activity_at = ? WHERE session_id = ?`,
      )
      .run(now, now, sessionId);

    return database.prepare(`SELECT * FROM prompt_queue WHERE id = ?`).get(item.id);
  });

  const claimed = tx();
  if (claimed) {
    emitChange("prompt_queue", "update", queueRowToPublic(claimed), claimed.id);
    const sess = getSessionRow(sessionId);
    if (sess) {
      emitChange("sessions", "update", sessionRowToPublic(sess), sessionId);
    }
  }
  return claimed;
}

/**
 * Try to mark session running immediately for an inline chat (no queue row).
 * Returns false if already running (and allowOverlap is false).
 */
export function tryMarkSessionRunning(sessionId, { allowOverlap = false } = {}) {
  const database = getDb();
  const tx = database.transaction(() => {
    const session = database
      .prepare(`SELECT * FROM sessions WHERE session_id = ?`)
      .get(sessionId);
    if (!session || session.closed_at != null) return { ok: false, reason: "missing" };
    if (!allowOverlap && session.run_status === "running") {
      return { ok: false, reason: "busy" };
    }
    const now = Date.now();
    database
      .prepare(
        `UPDATE sessions SET run_status = 'running', last_activity_at = ?, list_activity_at = ? WHERE session_id = ?`,
      )
      .run(now, now, sessionId);
    return { ok: true };
  });
  const result = tx();
  if (result.ok) {
    const sess = getSessionRow(sessionId);
    if (sess) {
      emitChange("sessions", "update", sessionRowToPublic(sess), sessionId);
    }
  }
  return result;
}

export function finishQueueItem(id, status = "done", error = null) {
  const now = Date.now();
  getDb()
    .prepare(
      `UPDATE prompt_queue
       SET status = ?, finished_at = ?, error = ?
       WHERE id = ?`,
    )
    .run(status, now, error, id);
  const saved = getQueueItem(id);
  if (saved) {
    emitChange("prompt_queue", "update", queueRowToPublic(saved), id);
  }
  return saved;
}

export function cancelQueuedItem(id) {
  const row = getQueueItem(id);
  if (!row || row.status !== "queued") return null;
  return finishQueueItem(id, "cancelled");
}

export function pruneFinishedQueueItems(olderThanMs = QUEUE_DONE_TTL_MS) {
  const cutoff = Date.now() - olderThanMs;
  return getDb()
    .prepare(
      `DELETE FROM prompt_queue
       WHERE status IN ('done', 'failed', 'cancelled')
         AND COALESCE(finished_at, created_at) < ?`,
    )
    .run(cutoff).changes;
}

export function queueRowToPublic(row) {
  if (!row) return null;
  let images = [];
  if (row.images_json) {
    try {
      images = JSON.parse(row.images_json);
    } catch {
      images = [];
    }
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    project: row.project,
    prompt: row.prompt,
    images,
    includeDevLogs: Boolean(row.include_dev_logs),
    source: row.source,
    allowOverlap: Boolean(row.allow_overlap),
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

// ── conversation reads ────────────────────────────────────────────────────

export function listConversationReadRows() {
  const rows = getDb().prepare(`SELECT * FROM conversation_reads`).all();
  /** @type {Record<string, object>} */
  const out = {};
  for (const row of rows) {
    out[row.key] = {
      lastReadAt: row.last_read_at,
      lastCompletedAt: row.last_completed_at,
      lastSortAt: row.last_sort_at,
    };
  }
  return out;
}

export function upsertConversationRead(key, project, agentId, entry) {
  getDb()
    .prepare(
      `INSERT INTO conversation_reads (
        key, project, agent_id, last_read_at, last_completed_at, last_sort_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        last_read_at = excluded.last_read_at,
        last_completed_at = excluded.last_completed_at,
        last_sort_at = excluded.last_sort_at`,
    )
    .run(
      key,
      project,
      agentId,
      entry.lastReadAt ?? 0,
      entry.lastCompletedAt ?? 0,
      entry.lastSortAt ?? 0,
    );
  const publicRow = {
    lastReadAt: entry.lastReadAt ?? 0,
    lastCompletedAt: entry.lastCompletedAt ?? 0,
    lastSortAt: entry.lastSortAt ?? 0,
  };
  emitChange("conversation_reads", "update", publicRow, key);
  return publicRow;
}

export function deleteConversationRead(key) {
  getDb().prepare(`DELETE FROM conversation_reads WHERE key = ?`).run(key);
  emitChange("conversation_reads", "delete", null, key);
}

export function getConversationReadRow(key) {
  return (
    getDb().prepare(`SELECT * FROM conversation_reads WHERE key = ?`).get(key) ??
    null
  );
}

// ── telegram topics ───────────────────────────────────────────────────────

export function upsertTelegramTopic(binding) {
  getDb()
    .prepare(
      `INSERT INTO telegram_topics (
        thread_id, session_id, agent_id, project, name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        session_id = excluded.session_id,
        agent_id = excluded.agent_id,
        project = excluded.project,
        name = excluded.name`,
    )
    .run(
      binding.threadId,
      binding.sessionId,
      binding.agentId,
      binding.project,
      binding.name,
      binding.createdAt ?? Date.now(),
    );
  return binding;
}

export function getTelegramTopicByThreadId(threadId) {
  const row = getDb()
    .prepare(`SELECT * FROM telegram_topics WHERE thread_id = ?`)
    .get(threadId);
  return row ? telegramTopicFromRow(row) : null;
}

export function getTelegramTopicBySessionId(sessionId) {
  const row = getDb()
    .prepare(`SELECT * FROM telegram_topics WHERE session_id = ?`)
    .get(sessionId);
  return row ? telegramTopicFromRow(row) : null;
}

export function getTelegramTopicByAgentId(agentId) {
  const row = getDb()
    .prepare(
      `SELECT * FROM telegram_topics WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(agentId);
  return row ? telegramTopicFromRow(row) : null;
}

export function listTelegramTopics() {
  return getDb()
    .prepare(`SELECT * FROM telegram_topics`)
    .all()
    .map(telegramTopicFromRow);
}

function telegramTopicFromRow(row) {
  return {
    threadId: row.thread_id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    project: row.project,
    name: row.name,
    createdAt: row.created_at,
  };
}

// ── kv ────────────────────────────────────────────────────────────────────

export function kvGet(key, fallback = null) {
  const row = getDb().prepare(`SELECT value_json FROM kv WHERE key = ?`).get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return fallback;
  }
}

export function kvSet(key, value) {
  getDb()
    .prepare(
      `INSERT INTO kv (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), Date.now());
  return value;
}

// ── JSON migration ────────────────────────────────────────────────────────

/** @param {import("better-sqlite3").Database} database */
function migrateJsonStores(database) {
  const migrated = database
    .prepare(`SELECT value FROM meta WHERE key = 'json_migrated'`)
    .get();
  if (migrated?.value === "1") return;

  const home = process.env.HOME || os.homedir();
  const dir = path.join(home, ".cursor-bridge");

  // conversation-reads.json
  try {
    const readsFile =
      process.env.CONVERSATION_READS_FILE ||
      path.join(dir, "conversation-reads.json");
    if (fs.existsSync(readsFile)) {
      const raw = JSON.parse(fs.readFileSync(readsFile, "utf8"));
      const byKey = raw?.byKey && typeof raw.byKey === "object" ? raw.byKey : {};
      const insert = database.prepare(
        `INSERT INTO conversation_reads (
          key, project, agent_id, last_read_at, last_completed_at, last_sort_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO NOTHING`,
      );
      const tx = database.transaction(() => {
        for (const [key, entry] of Object.entries(byKey)) {
          const colon = key.indexOf(":");
          const project = colon >= 0 ? key.slice(0, colon) : "";
          const agentId = colon >= 0 ? key.slice(colon + 1) : key;
          insert.run(
            key,
            project,
            agentId,
            entry?.lastReadAt ?? 0,
            entry?.lastCompletedAt ?? 0,
            entry?.lastSortAt ?? 0,
          );
        }
      });
      tx();
    }
  } catch (err) {
    console.warn(
      "[db] conversation-reads migrate failed:",
      err instanceof Error ? err.message : err,
    );
  }

  // telegram-agent-topics.json
  try {
    const topicsFile =
      process.env.TELEGRAM_TOPIC_STORE ||
      path.join(dir, "telegram-agent-topics.json");
    if (fs.existsSync(topicsFile)) {
      const raw = JSON.parse(fs.readFileSync(topicsFile, "utf8"));
      const byThread =
        raw?.byThreadId && typeof raw.byThreadId === "object"
          ? raw.byThreadId
          : {};
      const insert = database.prepare(
        `INSERT INTO telegram_topics (
          thread_id, session_id, agent_id, project, name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO NOTHING`,
      );
      const tx = database.transaction(() => {
        for (const binding of Object.values(byThread)) {
          if (!binding?.threadId) continue;
          insert.run(
            Number(binding.threadId),
            binding.sessionId || "",
            binding.agentId || "",
            binding.project || "",
            binding.name || "",
            binding.createdAt || Date.now(),
          );
        }
      });
      tx();
    }
  } catch (err) {
    console.warn(
      "[db] telegram-topics migrate failed:",
      err instanceof Error ? err.message : err,
    );
  }

  // telegram-prefs.json, telegram-phone.json, telegram-ide-mirror.json → kv
  for (const [fileName, kvKey] of [
    ["telegram-prefs.json", "telegram-prefs"],
    ["telegram-phone.json", "telegram-phone"],
    ["telegram-ide-mirror.json", "telegram-ide-mirror"],
  ]) {
    try {
      const filePath = path.join(dir, fileName);
      if (!fs.existsSync(filePath)) continue;
      const existing = database
        .prepare(`SELECT key FROM kv WHERE key = ?`)
        .get(kvKey);
      if (existing) continue;
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      database
        .prepare(
          `INSERT INTO kv (key, value_json, updated_at) VALUES (?, ?, ?)`,
        )
        .run(kvKey, JSON.stringify(value), Date.now());
    } catch (err) {
      console.warn(
        `[db] ${fileName} migrate failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  database
    .prepare(
      `INSERT INTO meta(key, value) VALUES('json_migrated', '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`,
    )
    .run();
}

/** Test helper: wipe all tables (keeps schema). */
export function _resetDbForTests() {
  const database = getDb();
  database.exec(`
    DELETE FROM events;
    DELETE FROM prompt_queue;
    DELETE FROM sessions;
    DELETE FROM conversation_reads;
    DELETE FROM telegram_topics;
    DELETE FROM kv;
    DELETE FROM meta WHERE key = 'json_migrated';
  `);
}
