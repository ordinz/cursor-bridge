import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { createSseEvent } from "./sse-events.js";
import { useTempBridgeDb } from "./test-db.js";
import { persistSessionRecord } from "./db.js";

useTempBridgeDb();
const { SessionEventHub } = await import("./session-events.js");
const { seedIdleSession, withTestServer } = await import("./test-http.js");

test("SessionEventHub fans out to WebSocket subscribers with seq", () => {
  useTempBridgeDb();
  const hub = new SessionEventHub();
  const sid = "s-fanout";
  persistSessionRecord({
    sessionId: sid,
    agentId: "a",
    project: "app",
    cwd: "/tmp",
    model: "default",
    mode: "agent",
    name: "t",
    namedFromPrompt: false,
    runStatus: "idle",
    lastPrompt: null,
    lastAssistantSnippet: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    listActivityAt: 0,
    telegramThreadId: null,
  });

  /** @type {object[]} */
  const received = [];
  const ws = {
    readyState: 1,
    send(data) {
      received.push(JSON.parse(data));
    },
  };

  hub.subscribeWs(sid, /** @type {any} */ (ws), { replay: false });
  hub.publish(sid, createSseEvent("assistant", sid, { text: "hi" }));

  assert.equal(received.length, 1);
  assert.equal(received[0].type, "assistant");
  assert.equal(received[0].text, "hi");
  assert.equal(received[0].seq, 1);
});

test("SessionEventHub replays only events after afterSeq", () => {
  useTempBridgeDb();
  const hub = new SessionEventHub();
  const sid = "s-replay";
  persistSessionRecord({
    sessionId: sid,
    agentId: "a",
    project: "app",
    cwd: "/tmp",
    model: "default",
    mode: "agent",
    name: "t",
    namedFromPrompt: false,
    runStatus: "idle",
    lastPrompt: null,
    lastAssistantSnippet: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    listActivityAt: 0,
    telegramThreadId: null,
  });

  hub.publish(sid, createSseEvent("assistant", sid, { text: "a" }));
  hub.publish(sid, createSseEvent("assistant", sid, { text: "b" }));
  hub.publish(sid, createSseEvent("assistant", sid, { text: "c" }));

  /** @type {object[]} */
  const received = [];
  const ws = {
    readyState: 1,
    send(data) {
      received.push(JSON.parse(data));
    },
  };

  hub.subscribeWs(sid, /** @type {any} */ (ws), { replay: true, afterSeq: 1 });
  assert.deepEqual(
    received.map((e) => e.text),
    ["b", "c"],
  );
});

test("GET upgrade /api/sessions/:id/ws streams published events", async () => {
  await withTestServer(async ({ sessions, wsBase }) => {
    const id = seedIdleSession(sessions);

    const events = [];
    const ws = new WebSocket(`${wsBase}/sessions/${id}/ws?replay=1`);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    const got = new Promise((resolve) => {
      ws.on("message", (data) => {
        const event = JSON.parse(String(data));
        events.push(event);
        if (event.type === "assistant" && event.text === "pong") resolve();
      });
    });

    sessions.publishEvent(
      id,
      createSseEvent("assistant", id, { text: "pong" }),
    );

    await Promise.race([
      got,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout waiting for ws event")), 2000),
      ),
    ]);

    assert.ok(events.some((e) => e.type === "assistant" && e.text === "pong"));
    assert.ok(events.every((e) => typeof e.seq === "number"));
    ws.close();
  });
});

test("session ws upgrade returns 404 for unknown session", async () => {
  await withTestServer(async ({ wsBase }) => {
    const missing = "33333333-3333-4333-8333-333333333333";
    const status = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wsBase}/sessions/${missing}/ws`);
      ws.once("open", () => {
        ws.close();
        reject(new Error("expected upgrade failure"));
      });
      ws.once("unexpected-response", (_req, res) => {
        const code = res.statusCode;
        res.resume();
        resolve(code);
      });
      ws.once("error", (err) => {
        // Some Node versions only emit error without unexpected-response.
        if (String(err.message).includes("404")) resolve(404);
        else reject(err);
      });
    });
    assert.equal(status, 404);
  });
});
