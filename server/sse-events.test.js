import test from "node:test";
import assert from "node:assert/strict";
import { createSseEvent } from "./sse-events.js";
import { SessionManager } from "./sessions.js";
import { SessionBusyError } from "./errors.js";

test("createSseEvent includes type, sessionId, and timestamp", () => {
  const event = createSseEvent("assistant", "sess-1", { text: "hi" });
  assert.equal(event.type, "assistant");
  assert.equal(event.sessionId, "sess-1");
  assert.equal(typeof event.timestamp, "string");
  assert.ok(!Number.isNaN(Date.parse(event.timestamp)));
  assert.equal(event.text, "hi");
});

test("SessionManager rejects overlapping chat", () => {
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
