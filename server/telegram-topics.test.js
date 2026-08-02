import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  _registerBindingForTests,
  _resetTelegramTopicStoreForTests,
  formatAgentTopicName,
  getBindingByAgentId,
  getBindingBySessionId,
  getBindingByThreadId,
  resolveTelegramThread,
} from "./telegram-topics.js";

const prev = {
  TELEGRAM_TOPIC_STATUS: process.env.TELEGRAM_TOPIC_STATUS,
  TELEGRAM_TOPIC_APP: process.env.TELEGRAM_TOPIC_APP,
  TELEGRAM_TOPIC_WWW: process.env.TELEGRAM_TOPIC_WWW,
  TELEGRAM_AGENT_TOPICS: process.env.TELEGRAM_AGENT_TOPICS,
};

before(() => {
  process.env.TELEGRAM_TOPIC_STATUS = "2";
  process.env.TELEGRAM_TOPIC_APP = "3";
  process.env.TELEGRAM_TOPIC_WWW = "4";
  process.env.TELEGRAM_AGENT_TOPICS = "1";
  _resetTelegramTopicStoreForTests();
});

after(() => {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetTelegramTopicStoreForTests();
});

test("formatAgentTopicName keeps project prefix and truncates", () => {
  const name = formatAgentTopicName(
    "app",
    "Fix the login redirect loop on staging",
  );
  assert.match(name, /^app · /);
  assert.ok(name.length <= 128);
});

test("resolveTelegramThread maps static project topics", () => {
  assert.deepEqual(resolveTelegramThread(2), {
    kind: "status",
    label: "status",
    binding: null,
  });
  assert.deepEqual(resolveTelegramThread(3), {
    kind: "project",
    label: "app",
    binding: null,
  });
});

test("resolveTelegramThread maps dynamic agent bindings", () => {
  _registerBindingForTests({
    threadId: 777,
    sessionId: "sess-1",
    agentId: "agent-1",
    project: "admin",
    name: "admin · Refund flow",
    createdAt: Date.now(),
  });

  const resolved = resolveTelegramThread(777);
  assert.equal(resolved.kind, "agent");
  assert.equal(resolved.label, "admin");
  assert.equal(resolved.binding?.sessionId, "sess-1");
  assert.equal(getBindingByThreadId(777)?.project, "admin");
  assert.equal(getBindingBySessionId("sess-1")?.threadId, 777);
  assert.equal(getBindingByAgentId("agent-1")?.threadId, 777);

  assert.deepEqual(resolveTelegramThread(99999), {
    kind: "unknown",
    label: null,
    binding: null,
  });
});
