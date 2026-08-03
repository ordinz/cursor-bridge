import assert from "node:assert/strict";
import test from "node:test";
import { useTempBridgeDb, resetTempBridgeDb } from "./test-db.js";
import {
  appendEvent,
  claimNextQueueItem,
  getMaxEventSeq,
  insertQueueItem,
  listEventsAfter,
  listOpenSessionRows,
  persistSessionRecord,
  tryMarkSessionRunning,
  upsertSessionRow,
} from "./db.js";
import { enqueueOrClaim, listQueue } from "./prompt-queue.js";
import { SessionEventHub } from "./session-events.js";
import { getRealtimeBus, _resetRealtimeBusForTests } from "./realtime.js";

useTempBridgeDb();

test("db persists sessions across reopen", () => {
  resetTempBridgeDb();
  const now = Date.now();
  upsertSessionRow({
    session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    agent_id: "agent-1",
    project: "app",
    cwd: "/tmp/app",
    model: "default",
    mode: "agent",
    name: "Test",
    named_from_prompt: 0,
    run_status: "idle",
    created_at: now,
    last_activity_at: now,
    list_activity_at: now,
  });
  const open = listOpenSessionRows();
  assert.equal(open.length, 1);
  assert.equal(open[0].agent_id, "agent-1");
});

test("events append with monotonic seq and replay after", () => {
  resetTempBridgeDb();
  const sid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  persistSessionRecord({
    sessionId: sid,
    agentId: "a",
    project: "app",
    cwd: "/tmp",
    model: "default",
    mode: "agent",
    name: "e",
    namedFromPrompt: false,
    runStatus: "idle",
    lastPrompt: null,
    lastAssistantSnippet: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    listActivityAt: 0,
    telegramThreadId: null,
  });

  const e1 = appendEvent(sid, { type: "user", sessionId: sid, text: "hi" });
  const e2 = appendEvent(sid, { type: "assistant", sessionId: sid, text: "yo" });
  assert.equal(e1.seq, 1);
  assert.equal(e2.seq, 2);
  assert.equal(getMaxEventSeq(sid), 2);

  const after = listEventsAfter(sid, 1);
  assert.equal(after.length, 1);
  assert.equal(after[0].type, "assistant");
});

test("SessionEventHub records durable events", () => {
  resetTempBridgeDb();
  const sid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  persistSessionRecord({
    sessionId: sid,
    agentId: "a",
    project: "app",
    cwd: "/tmp",
    model: "default",
    mode: "agent",
    name: "e",
    namedFromPrompt: false,
    runStatus: "idle",
    lastPrompt: null,
    lastAssistantSnippet: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    listActivityAt: 0,
    telegramThreadId: null,
  });
  const hub = new SessionEventHub();
  hub.startRun(sid);
  hub.record(sid, { type: "status", sessionId: sid, status: "RUNNING" });
  hub.record(sid, { type: "assistant", sessionId: sid, text: "x" });
  // startRun must not clear prior events
  hub.startRun(sid);
  const all = listEventsAfter(sid, 0);
  assert.equal(all.length, 2);
});

test("queue claim is atomic with session running", () => {
  resetTempBridgeDb();
  const sid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  persistSessionRecord({
    sessionId: sid,
    agentId: "a",
    project: "app",
    cwd: "/tmp",
    model: "default",
    mode: "agent",
    name: "q",
    namedFromPrompt: false,
    runStatus: "idle",
    lastPrompt: null,
    lastAssistantSnippet: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    listActivityAt: 0,
    telegramThreadId: null,
  });

  insertQueueItem({
    id: "q1",
    session_id: sid,
    project: "app",
    prompt: "first",
    created_at: Date.now(),
  });
  insertQueueItem({
    id: "q2",
    session_id: sid,
    project: "app",
    prompt: "second",
    created_at: Date.now() + 1,
  });

  const claimed = claimNextQueueItem(sid);
  assert.equal(claimed.id, "q1");
  assert.equal(claimed.status, "running");

  const again = claimNextQueueItem(sid);
  assert.equal(again, null);

  const immediate = tryMarkSessionRunning(sid);
  assert.equal(immediate.ok, false);
  assert.equal(immediate.reason, "busy");
});

test("enqueueOrClaim queues when busy", () => {
  resetTempBridgeDb();
  const sid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  persistSessionRecord({
    sessionId: sid,
    agentId: "a",
    project: "app",
    cwd: "/tmp",
    model: "default",
    mode: "agent",
    name: "q",
    namedFromPrompt: false,
    runStatus: "running",
    lastPrompt: null,
    lastAssistantSnippet: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    listActivityAt: 0,
    telegramThreadId: null,
  });

  const result = enqueueOrClaim({
    sessionId: sid,
    project: "app",
    prompt: "wait",
  });
  assert.equal(result.mode, "queued");
  assert.ok(result.item?.id);
  assert.equal(listQueue({ sessionId: sid, status: "queued" }).length, 1);
});

test("realtime bus emits db.change", () => {
  resetTempBridgeDb();
  _resetRealtimeBusForTests();
  const bus = getRealtimeBus();
  const messages = [];
  const fakeWs = {
    readyState: 1,
    send(data) {
      messages.push(JSON.parse(data));
    },
  };
  const unsub = bus.subscribe(fakeWs, { tables: ["sessions"] });
  bus.emit({ table: "sessions", op: "update", row: { sessionId: "x" } });
  bus.emit({ table: "prompt_queue", op: "insert", row: { id: "y" } });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "db.change");
  assert.equal(messages[0].table, "sessions");
  unsub();
});
