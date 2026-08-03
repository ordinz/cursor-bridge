import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDevLogsDir } from "./dev-logs.js";
import { serializeSdkEvent, streamRun } from "./stream.js";
import {
  seedIdleSession,
  seedRunningSession,
  withTestServer,
} from "./test-http.js";
import { validatePrompt, validateProjectId } from "./validate.js";
import { NoActiveRunError } from "./errors.js";
import { useTempBridgeDb } from "./test-db.js";

useTempBridgeDb();
const { SessionManager } = await import("./sessions.js");

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

test("validateChatPayload accepts images without embedding in prompt text", async () => {
  const { validateChatPayload, buildDisplayPromptWithImages, PROMPT_MAX_LENGTH } =
    await import("./validate.js");

  const tinyJpegBase64 =
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z";

  const oversizedPrompt = "x".repeat(PROMPT_MAX_LENGTH + 1);
  assert.throws(
    () => validateChatPayload(oversizedPrompt, undefined),
    /exceeds maximum length/,
  );

  // Image as separate field — prompt stays short even when image is large.
  const largeImage = "A".repeat(150_000);
  const { text, images } = validateChatPayload("look", [
    { data: largeImage, mimeType: "image/jpeg", name: "shot.jpg" },
  ]);
  assert.equal(text, "look");
  assert.equal(images.length, 1);
  assert.equal(images[0].data.length, 150_000);
  assert.ok(text.length < PROMPT_MAX_LENGTH);

  const fromDataUrl = validateChatPayload(null, [
    { dataUrl: `data:image/png;base64,${tinyJpegBase64}` },
  ]);
  assert.ok(fromDataUrl.text.length > 0);
  assert.equal(fromDataUrl.images[0].mimeType, "image/png");

  const display = buildDisplayPromptWithImages("hi", [
    { data: tinyJpegBase64, mimeType: "image/jpeg", name: "a.jpg" },
  ]);
  assert.match(display, /^hi\n\n!\[a\.jpg\]\(data:image\/jpeg;base64,/);
});

test("validateProjectId rejects path traversal", () => {
  assert.throws(() => validateProjectId("../etc"), /unknown project/);
  assert.throws(() => validateProjectId("foo/bar"), /unknown project/);
});

test("busy session queues chat with 202", async () => {
  await withTestServer(async ({ sessions, base }) => {
    const id = seedRunningSession(sessions);
    const res = await fetch(`${base}/sessions/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.queued, true);
    assert.ok(body.item?.id);
    assert.equal(body.item.status, "queued");
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
  useTempBridgeDb();
  const sessions = new SessionManager();
  const id = seedRunningSession(sessions);
  const result = await sessions.cancel(id);
  assert.equal(result.runStatus, "cancelled");
  const detail = sessions.getDetail(id);
  assert.equal(detail.runStatus, "cancelled");
  assert.equal(detail.runActive, false);
});

test("cancel idle session throws NoActiveRunError", async () => {
  useTempBridgeDb();
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
    assert.ok(spec.paths["/sessions/{id}/ws"]);
    assert.ok(spec.paths["/sessions"]);
    assert.ok(spec.paths["/projects/{projectId}/dev-status"]);
    assert.ok(spec.paths["/projects/{projectId}/dev-logs"]);
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

test("chat with includeDevLogs emits DEV_LOGS status when logs present", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-dev-logs-route-"));
  const previous = process.env.CURSOR_BRIDGE_DEV_LOGS_DIR;
  process.env.CURSOR_BRIDGE_DEV_LOGS_DIR = dir;

  try {
    await withTestServer(async ({ sessions, base }) => {
      const id = seedIdleSession(sessions);
      ensureDevLogsDir();
      const logPath = path.join(dir, "app.log");
      fs.writeFileSync(logPath, "compile error in route.ts\n");

    const events = await readSseUntil(
      await fetch(`${base}/sessions/${id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Fix compile error", includeDevLogs: true }),
      }),
      (event) => event.type === "done" || event.type === "error",
    );

    const devLogsStatus = events.find(
      (e) => e.type === "status" && e.status === "DEV_LOGS",
    );
    assert.ok(devLogsStatus);
    assert.match(devLogsStatus.message, /Included 1 lines of dev server logs/);

    const userEvent = events.find((e) => e.type === "user");
    assert.equal(userEvent.text, "Fix compile error");
    });
  } finally {
    if (previous === undefined) {
      delete process.env.CURSOR_BRIDGE_DEV_LOGS_DIR;
    } else {
      process.env.CURSOR_BRIDGE_DEV_LOGS_DIR = previous;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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

test("chat with images sends SDK image payload, not base64-in-prompt", async () => {
  await withTestServer(async ({ sessions, base }) => {
    const id = seedIdleSession(sessions);
    const record = sessions.get(id);
    let sent = null;
    record.agent.send = async (message) => {
      sent = message;
      return {
        supports: (op) => op === "cancel",
        cancel: async () => {},
        stream: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "saw it" }] },
          };
        },
        wait: async () => ({ id: "run-img", status: "finished" }),
      };
    };

    const imageData = "A".repeat(120_000);
    const events = await readSseUntil(
      await fetch(`${base}/sessions/${id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "what is this?",
          images: [{ data: imageData, mimeType: "image/jpeg", name: "big.jpg" }],
        }),
      }),
      (event) => event.type === "done" || event.type === "error",
    );

    assert.ok(sent && typeof sent === "object");
    assert.equal(sent.text, "what is this?");
    assert.equal(sent.images.length, 1);
    assert.equal(sent.images[0].data.length, 120_000);
    assert.equal(sent.images[0].mimeType, "image/jpeg");

    const userEvent = events.find((e) => e.type === "user");
    assert.equal(userEvent.imageCount, 1);
    assert.equal(userEvent.text, "what is this?");
    assert.ok(!String(userEvent.text).includes("base64"));
    assert.ok(!events.some((e) => e.type === "error"));
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

test("POST /telegram/send returns 503 when not configured", async () => {
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  const prevChat = process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;

  try {
    await withTestServer(async ({ base }) => {
      const res = await fetch(`${base}/telegram/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.code, "TELEGRAM_NOT_CONFIGURED");
    });
  } finally {
    if (prevToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = prevToken;
    if (prevChat !== undefined) process.env.TELEGRAM_CHAT_ID = prevChat;
  }
});

test("POST /telegram/send returns 503 when TELEGRAM_ENABLED=0", async () => {
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  const prevChat = process.env.TELEGRAM_CHAT_ID;
  const prevEnabled = process.env.TELEGRAM_ENABLED;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "-100123";
  process.env.TELEGRAM_ENABLED = "0";

  try {
    await withTestServer(async ({ base }) => {
      const res = await fetch(`${base}/telegram/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.code, "TELEGRAM_NOT_CONFIGURED");
    });
  } finally {
    if (prevToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = prevToken;
    else delete process.env.TELEGRAM_BOT_TOKEN;
    if (prevChat !== undefined) process.env.TELEGRAM_CHAT_ID = prevChat;
    else delete process.env.TELEGRAM_CHAT_ID;
    if (prevEnabled !== undefined) process.env.TELEGRAM_ENABLED = prevEnabled;
    else delete process.env.TELEGRAM_ENABLED;
  }
});

test("POST /telegram rejects empty message", async () => {
  await withTestServer(async ({ base }) => {
    const res = await fetch(`${base}/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "   " }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, "INVALID_REQUEST");
  });
});
