import test from "node:test";
import assert from "node:assert/strict";
import { createSseEvent } from "./sse-events.js";
import { SessionBusyError } from "./errors.js";
import { useTempBridgeDb } from "./test-db.js";

useTempBridgeDb();
const { SessionManager } = await import("./sessions.js");

test("createSseEvent includes type, sessionId, and timestamp", () => {
  const event = createSseEvent("assistant", "sess-1", { text: "hi" });
  assert.equal(event.type, "assistant");
  assert.equal(event.sessionId, "sess-1");
  assert.equal(typeof event.timestamp, "string");
  assert.ok(!Number.isNaN(Date.parse(event.timestamp)));
  assert.equal(event.text, "hi");
});

test("SessionManager rejects overlapping chat", () => {
  useTempBridgeDb();
  const sessions = new SessionManager();
  const id = "test-session";
  sessions.sessions.set(id, {
    sessionId: id,
    agent: {},
    agentId: "agent-1",
    project: "app",
    cwd: "/tmp",
    model: "default",
    name: "test",
    namedFromPrompt: false,
    activeRun: { supports: () => false },
    runStatus: "running",
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    lastPrompt: null,
    lastAssistantSnippet: null,
  });

  assert.throws(
    () => sessions.assertCanChat(id),
    (err) => err instanceof SessionBusyError,
  );
});

test("SessionManager allows chat when idle", () => {
  useTempBridgeDb();
  const sessions = new SessionManager();
  const id = "idle-session";
  sessions.sessions.set(id, {
    sessionId: id,
    agent: {},
    agentId: "agent-2",
    project: "app",
    cwd: "/tmp",
    model: "default",
    name: "test",
    namedFromPrompt: false,
    activeRun: null,
    runStatus: "idle",
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    lastPrompt: null,
    lastAssistantSnippet: null,
  });

  const record = sessions.assertCanChat(id);
  assert.equal(record.sessionId, id);
});

test("closeByAgentId closes every open session for the agent", async () => {
  useTempBridgeDb();
  const sessions = new SessionManager();
  const agentId = "agent-archive-multi";
  for (const id of ["sess-a", "sess-b", "sess-other"]) {
    sessions.sessions.set(id, {
      sessionId: id,
      agent: { close() {} },
      agentId: id === "sess-other" ? "agent-other" : agentId,
      project: "app",
      cwd: "/tmp",
      model: "default",
      name: "test",
      namedFromPrompt: false,
      activeRun: null,
      abortController: null,
      runStatus: "idle",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      listActivityAt: Date.now(),
      lastPrompt: null,
      lastAssistantSnippet: null,
      closedAt: null,
    });
  }

  const closed = await sessions.closeByAgentId(agentId);
  assert.deepEqual(closed.sort(), ["sess-a", "sess-b"]);
  assert.equal(sessions.get("sess-a"), null);
  assert.equal(sessions.get("sess-b"), null);
  assert.ok(sessions.get("sess-other"));
});
