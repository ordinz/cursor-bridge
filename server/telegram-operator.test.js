import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { requireRemoteApiKey } from "./remote-auth.js";
import {
  getTelegramTopicMap,
  resolveWebhookPublicUrl,
} from "./telegram.js";
import { createDraftStreamer } from "./telegram-draft.js";
import {
  getPhoneModeState,
  isPhoneModeOn,
  setPhoneMode,
} from "./telegram-phone.js";
import { createTelegramWebhookHandler } from "./telegram-operator.js";
import { SessionManager } from "./sessions.js";

const savedMcpKey = process.env.MCP_API_KEY;
const savedBridgeKey = process.env.BRIDGE_API_KEY;

test.afterEach(() => {
  if (savedMcpKey === undefined) delete process.env.MCP_API_KEY;
  else process.env.MCP_API_KEY = savedMcpKey;
  if (savedBridgeKey === undefined) delete process.env.BRIDGE_API_KEY;
  else process.env.BRIDGE_API_KEY = savedBridgeKey;
});

test("requireRemoteApiKey skips telegram webhook path on remote host", () => {
  delete process.env.MCP_API_KEY;
  delete process.env.BRIDGE_API_KEY;
  let nextCalled = false;
  const req = {
    headers: { host: "mbp.thematrixofdestiny.com" },
    path: "/cursor-bridge/telegram/webhook",
    method: "POST",
  };
  const res = {
    status() {
      return this;
    },
    json() {
      return this;
    },
  };
  requireRemoteApiKey(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test("resolveWebhookPublicUrl uses TELEGRAM_TUNNEL_HOST by default", () => {
  const prevUrl = process.env.TELEGRAM_WEBHOOK_PUBLIC_URL;
  const prevTgHost = process.env.TELEGRAM_TUNNEL_HOST;
  const prevHost = process.env.TUNNEL_HOST;
  delete process.env.TELEGRAM_WEBHOOK_PUBLIC_URL;
  delete process.env.TUNNEL_HOST;
  process.env.TELEGRAM_TUNNEL_HOST = "cursor-bridge.example.com";
  assert.equal(
    resolveWebhookPublicUrl(),
    "https://cursor-bridge.example.com/cursor-bridge/telegram/webhook",
  );
  if (prevUrl === undefined) delete process.env.TELEGRAM_WEBHOOK_PUBLIC_URL;
  else process.env.TELEGRAM_WEBHOOK_PUBLIC_URL = prevUrl;
  if (prevTgHost === undefined) delete process.env.TELEGRAM_TUNNEL_HOST;
  else process.env.TELEGRAM_TUNNEL_HOST = prevTgHost;
  if (prevHost === undefined) delete process.env.TUNNEL_HOST;
  else process.env.TUNNEL_HOST = prevHost;
});

test("getTelegramTopicMap parses topic env ids", () => {
  const prev = {
    status: process.env.TELEGRAM_TOPIC_STATUS,
    app: process.env.TELEGRAM_TOPIC_APP,
    www: process.env.TELEGRAM_TOPIC_WWW,
  };
  process.env.TELEGRAM_TOPIC_STATUS = "11";
  process.env.TELEGRAM_TOPIC_APP = "22";
  process.env.TELEGRAM_TOPIC_WWW = "33";
  assert.deepEqual(getTelegramTopicMap(), {
    status: 11,
    app: 22,
    www: 33,
  });
  for (const [k, v] of Object.entries(prev)) {
    const key = `TELEGRAM_TOPIC_${k.toUpperCase()}`;
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
});

test("phone mode persists toggle", () => {
  const before = getPhoneModeState().phoneMode;
  setPhoneMode(true);
  assert.equal(isPhoneModeOn(), true);
  setPhoneMode(false);
  assert.equal(isPhoneModeOn(), false);
  setPhoneMode(before);
});

test("createDraftStreamer accumulates text until finalize", async () => {
  const streamer = createDraftStreamer({ messageThreadId: 1, throttleMs: 10 });
  streamer.push("Hello ");
  streamer.push("world");
  assert.equal(streamer.getBuffer(), "Hello world");
  await streamer.finalize().catch(() => {});
});

test("webhook rejects bad secret and accepts valid secret", async () => {
  const prev = {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chat: process.env.TELEGRAM_CHAT_ID,
    secret: process.env.TELEGRAM_WEBHOOK_SECRET,
  };
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "-100123";
  process.env.TELEGRAM_WEBHOOK_SECRET = "sekrit";

  const sessions = new SessionManager();
  const app = express();
  app.use(express.json());
  app.post(
    "/cursor-bridge/telegram/webhook",
    createTelegramWebhookHandler(sessions),
  );

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/cursor-bridge/telegram/webhook`;

  try {
    const bad = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "wrong",
      },
      body: JSON.stringify({ update_id: 1 }),
    });
    assert.equal(bad.status, 401);

    const good = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "sekrit",
      },
      body: JSON.stringify({ update_id: 1 }),
    });
    assert.equal(good.status, 200);
    const body = await good.json();
    assert.equal(body.ok, true);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    if (prev.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prev.token;
    if (prev.chat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = prev.chat;
    if (prev.secret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
    else process.env.TELEGRAM_WEBHOOK_SECRET = prev.secret;
  }
});
