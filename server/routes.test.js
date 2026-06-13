import test from "node:test";
import assert from "node:assert/strict";
import { serializeSdkEvent, streamRun } from "./stream.js";
import {
  seedIdleSession,
  seedRunningSession,
  withTestServer,
} from "./test-http.js";
import { validatePrompt, validateProjectId } from "./validate.js";
import { SessionManager } from "./sessions.js";
import { NoActiveRunError } from "./errors.js";

function createMockRes() {
  const chunks = [];
  let ended = false;
  const res = {
    get writableEnded() {
      return ended;
    },
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
    end() {
      ended = true;
    },
    flushHeaders() {},
  };
  return { res, chunks, text: () => chunks.join("") };
}

function parseSseEvents(text) {
  const events = [];
  for (const block of text.split("\n\n")) {
    for (const line of block.split("\n")) {
      if (line.startsWith("data: ")) {
        events.push(JSON.parse(line.slice(6)));
      }
    }
  }
  return events;
}

test("validatePrompt rejects empty and whitespace", () => {
  assert.throws(() => validatePrompt(""), /must not be empty/);
  assert.throws(() => validatePrompt("   "), /must not be empty/);
  assert.throws(() => validatePrompt(null), /required/);
});

test("validateProjectId rejects path traversal", () => {
  assert.throws(() => validateProjectId("../etc"), /unknown project/);
  assert.throws(() => validateProjectId("foo/bar"), /unknown project/);
});

test("SESSION_BUSY returns 409 JSON", async () => {
  await withTestServer(async ({ sessions, base }) => {
    const id = seedRunningSession(sessions);
    const res = await fetch(`${base}/sessions/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "SESSION_BUSY");
  });
});

test("malformed chat request returns 400 JSON", async () => {
  await withTestServer(async ({ sessions, base }) => {
    const id = seedIdleSession(sessions);
    const res = await fetch(`${base}/sessions/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "   " }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, "INVALID_REQUEST");
  });
});

test("cancel on idle session returns 409 NO_ACTIVE_RUN", async () => {
  await withTestServer(async ({ sessions, base }) => {
    const id = seedIdleSession(sessions);
    const res = await fetch(`${base}/sessions/${id}/cancel`, { method: "POST" });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "NO_ACTIVE_RUN");
  });
});

test("cancel on active run updates session status", async () => {
  const sessions = new SessionManager();
  const id = seedRunningSession(sessions);
  const result = await sessions.cancel(id);
  assert.equal(result.runStatus, "cancelled");
  const detail = sessions.getDetail(id);
  assert.equal(detail.runStatus, "cancelled");
  assert.equal(detail.runActive, false);
});

test("cancel idle session throws NoActiveRunError", async () => {
  const sessions = new SessionManager();
  const id = seedIdleSession(sessions);
  await assert.rejects(() => sessions.cancel(id), NoActiveRunError);
});

test("SSE event ordering for a normal run", async () => {
  const { res, text } = createMockRes();
  const run = {
    supports: () => true,
    cancel: async () => {},
    stream: async function* () {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "Hi " }] },
      };
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "there" }] },
      };
    },
    wait: async () => ({ id: "run-abc", status: "finished" }),
  };

  const outcome = await streamRun(res, run, { sessionId: "sess-1" });
  res.end();

  const events = parseSseEvents(text());
  const types = events.map((e) => e.type);

  assert.deepEqual(types, ["assistant", "assistant", "done"]);
  assert.equal(events.filter((e) => e.type === "done").length, 1);
  assert.equal(outcome.done.status, "finished");
  assert.equal(events[0].text, "Hi ");
  assert.equal(events[1].text, "there");
});

test("SSE emits error without done on stream failure", async () => {
  const { res, text } = createMockRes();
  const run = {
    supports: () => false,
    stream: async function* () {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "x" }] },
      };
      throw new Error("boom");
    },
    wait: async () => ({ id: "run-err", status: "finished" }),
  };

  const outcome = await streamRun(res, run, { sessionId: "sess-2" });
  res.end();

  const events = parseSseEvents(text());
  assert.equal(outcome.failed, true);
  assert.equal(events.some((e) => e.type === "error"), true);
  assert.equal(events.some((e) => e.type === "done"), false);
});

test("SSE cancel emits status and done once", async () => {
  const { res, text } = createMockRes();
  const controller = new AbortController();

  const run = {
    supports: (op) => op === "cancel",
    cancel: async () => {},
    stream: async function* () {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "partial" }] },
      };
      await new Promise((r) => setTimeout(r, 20));
      if (controller.signal.aborted) return;
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "more" }] },
      };
    },
    wait: async () => ({ id: "run-cancel", status: "cancelled" }),
  };

  setTimeout(() => controller.abort(), 5);

  const outcome = await streamRun(res, run, {
    sessionId: "sess-3",
    signal: controller.signal,
  });
  res.end();

  const events = parseSseEvents(text());
  assert.equal(outcome.cancelled, true);
  assert.equal(events.filter((e) => e.type === "done").length, 1);
  assert.equal(events.at(-1).status, "cancelled");
});

test("GET /projects returns only allowlisted projects without paths", async () => {
  await withTestServer(async ({ base }) => {
    const res = await fetch(`${base}/projects`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.projects));
    assert.ok(!("root" in body));
    assert.ok(!("enabledProjectIds" in body));
    for (const p of body.projects) {
      assert.ok(!("path" in p));
      assert.equal(p.canCreateSession, true);
    }
  });
});

test("openapi.json describes core routes", async () => {
  await withTestServer(async ({ base }) => {
    const res = await fetch(`${base}/openapi.json`);
    assert.equal(res.status, 200);
    const spec = await res.json();
    assert.ok(spec.paths["/health"]);
    assert.ok(spec.paths["/projects"]);
    assert.ok(spec.paths["/sessions/{id}"]);
    assert.ok(spec.paths["/sessions/{id}/events"]);
    assert.ok(spec.paths["/sessions"]);
    assert.ok(spec.paths["/sessions/{id}/chat"]);
    assert.ok(spec.paths["/sessions/{id}/cancel"]);
  });
});

async function readSseUntil(
  response,
  stopWhen,
) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (line.startsWith("data: ")) {
          const event = JSON.parse(line.slice(6));
          events.push(event);
          if (stopWhen(event)) {
            await reader.cancel();
            return events;
          }
        }
      }
    }
  }

  return events;
}

test("watch stream receives chat events", async () => {
  await withTestServer(async ({ sessions, base }) => {
    const id = seedIdleSession(sessions);

    const watchRes = await fetch(`${base}/sessions/${id}/events`);
    assert.equal(watchRes.status, 200);

    const watchPromise = readSseUntil(
      watchRes,
      (event) => event.type === "done" || event.type === "error",
    );

    await new Promise((r) => setTimeout(r, 30));

    const chatEvents = await readSseUntil(
      await fetch(`${base}/sessions/${id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hello" }),
      }),
      (event) => event.type === "done" || event.type === "error",
    );

    const watchEvents = await watchPromise;

    assert.ok(chatEvents.some((e) => e.type === "assistant"));
    assert.ok(watchEvents.some((e) => e.type === "assistant"));
    assert.ok(watchEvents.some((e) => e.type === "user" && e.text === "hello"));
  });
});

test("GET /sessions/:id/events returns 404 for missing session", async () => {
  await withTestServer(async ({ base }) => {
    const res = await fetch(
      `${base}/sessions/33333333-3333-4333-8333-333333333333/events`,
    );
    assert.equal(res.status, 404);
  });
});

test("serializeSdkEvent splits tool_call and tool_result", () => {
  const running = serializeSdkEvent(
    {
      type: "tool_call",
      call_id: "c1",
      name: "read",
      status: "running",
      args: { path: "a.ts" },
    },
    "s1",
  );
  assert.equal(running.type, "tool_call");
  assert.equal(running.status, "running");

  const done = serializeSdkEvent(
    {
      type: "tool_call",
      call_id: "c1",
      name: "read",
      status: "completed",
      result: { ok: true },
    },
    "s1",
  );
  assert.equal(done.type, "tool_result");
});
