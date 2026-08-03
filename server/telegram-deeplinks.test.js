import test from "node:test";
import assert from "node:assert/strict";
import {
  bridgeUiOrigin,
  forumTopicUrl,
  telegramInternalChatId,
  uiSessionUrl,
} from "./telegram-deeplinks.js";

test("telegramInternalChatId strips -100 prefix", () => {
  assert.equal(telegramInternalChatId("-1001234567890"), "1234567890");
  assert.equal(telegramInternalChatId("1234567890"), "1234567890");
  assert.equal(telegramInternalChatId(null), null);
});

test("forumTopicUrl builds private forum topic links", () => {
  assert.equal(
    forumTopicUrl("-1001234567890", 69),
    "https://t.me/c/1234567890/69",
  );
  assert.equal(
    forumTopicUrl("-1001234567890", 69, 420),
    "https://t.me/c/1234567890/69/420",
  );
  assert.equal(forumTopicUrl("-1001234567890", 69, 69), "https://t.me/c/1234567890/69");
  assert.equal(forumTopicUrl(null, 69), null);
});

test("uiSessionUrl encodes project and agent", () => {
  const url = uiSessionUrl({
    origin: "https://ordins-cursor-bridge.kairose.com",
    project: "cursor-bridge",
    agentId: "agent-abc",
  });
  assert.equal(
    url,
    "https://ordins-cursor-bridge.kairose.com/?project=cursor-bridge&agent=agent-abc&tab=feed",
  );
  assert.equal(uiSessionUrl({ project: "app" }), null);
});

test("bridgeUiOrigin defaults to tunnel host", () => {
  const prev = process.env.BRIDGE_UI_ORIGIN;
  delete process.env.BRIDGE_UI_ORIGIN;
  assert.equal(bridgeUiOrigin(), "https://ordins-cursor-bridge.kairose.com");
  process.env.BRIDGE_UI_ORIGIN = "https://example.com/";
  assert.equal(bridgeUiOrigin(), "https://example.com");
  if (prev === undefined) delete process.env.BRIDGE_UI_ORIGIN;
  else process.env.BRIDGE_UI_ORIGIN = prev;
});
