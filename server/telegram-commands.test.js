import test from "node:test";
import assert from "node:assert/strict";
import { TELEGRAM_BOT_COMMANDS } from "./telegram.js";

test("TELEGRAM_BOT_COMMANDS has unique valid names", () => {
  const names = TELEGRAM_BOT_COMMANDS.map((c) => c.command);
  assert.equal(new Set(names).size, names.length);
  for (const c of TELEGRAM_BOT_COMMANDS) {
    assert.match(c.command, /^[a-z0-9_]{1,32}$/);
    assert.ok(c.description.length > 0 && c.description.length <= 256);
  }
  assert.ok(names.includes("phone_on"));
  assert.ok(names.includes("settings"));
  assert.ok(names.includes("help"));
});

test("menu @bot suffix stripping", () => {
  const strip = (text) =>
    text.trim().replace(/^(\/[a-zA-Z0-9_]+)@[A-Za-z0-9_]+/, "$1");
  assert.equal(strip("/status@cursor_bridge_mbp_bot"), "/status");
  assert.equal(strip("/phone_on@cursor_bridge_mbp_bot"), "/phone_on");
  assert.equal(strip("/phone on"), "/phone on");
});
