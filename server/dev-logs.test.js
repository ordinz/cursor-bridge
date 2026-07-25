import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildPromptWithDevLogs,
  ensureDevLogsDir,
  getRecentLogs,
  RingBuffer,
} from "./dev-logs.js";
import { validateCombinedPrompt } from "./validate.js";

function withTempDevLogsDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-dev-logs-"));
  const previous = process.env.CURSOR_BRIDGE_DEV_LOGS_DIR;
  process.env.CURSOR_BRIDGE_DEV_LOGS_DIR = dir;
  return fn(dir).finally(() => {
    if (previous === undefined) {
      delete process.env.CURSOR_BRIDGE_DEV_LOGS_DIR;
    } else {
      process.env.CURSOR_BRIDGE_DEV_LOGS_DIR = previous;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test("RingBuffer truncates by line count", () => {
  const buf = new RingBuffer(3, 1024);
  buf.push("line 1");
  buf.push("line 2");
  buf.push("line 3");
  buf.push("line 4");
  const tail = buf.tail();
  assert.equal(tail.length, 3);
  assert.match(tail[0], /line 2/);
  assert.match(tail[2], /line 4/);
});

test("RingBuffer truncates by byte size", () => {
  const buf = new RingBuffer(100, 80);
  for (let i = 0; i < 20; i++) {
    buf.push(`entry-${i}-${"x".repeat(20)}`);
  }
  assert.ok(buf.lineCount < 20);
});

test("getRecentLogs reads recent file tail", async () => {
  await withTempDevLogsDir(async (dir) => {
    ensureDevLogsDir();
    const logPath = path.join(dir, "app.log");
    fs.writeFileSync(logPath, ["alpha", "beta", "gamma"].join("\n") + "\n");

    const result = await getRecentLogs("app", { lines: 2 });
    assert.equal(result.source, "file");
    assert.deepEqual(result.lines, ["beta", "gamma"]);
  });
});

test("getRecentLogs ignores stale log files", async () => {
  await withTempDevLogsDir(async (dir) => {
    ensureDevLogsDir();
    const logPath = path.join(dir, "www.log");
    fs.writeFileSync(logPath, "stale line\n");
    const stale = Date.now() - 3 * 60 * 60 * 1000;
    fs.utimesSync(logPath, stale / 1000, stale / 1000);

    const result = await getRecentLogs("www", { lines: 10 });
    assert.equal(result.source, "none");
    assert.deepEqual(result.lines, []);
  });
});

test("buildPromptWithDevLogs wraps lines in delimiter block", async () => {
  await withTempDevLogsDir(async (dir) => {
    ensureDevLogsDir();
    const logPath = path.join(dir, "app.log");
    fs.writeFileSync(logPath, "server error: boom\n");

    const result = await buildPromptWithDevLogs("app", "Fix the bug");
    assert.equal(result.logsAttached, true);
    assert.match(result.prompt, /--- Dev server logs \(app, localhost:3000/);
    assert.match(result.prompt, /server error: boom/);
    assert.match(result.prompt, /--- End dev server logs ---/);
    assert.match(result.prompt, /Fix the bug$/);
  });
});

test("validateCombinedPrompt rejects oversized augmented prompt", () => {
  const userPrompt = "hello";
  const huge = "x".repeat(100_001);
  assert.throws(
    () => validateCombinedPrompt(userPrompt, huge),
    /exceeds maximum length/,
  );
});

test("buildPromptWithDevLogs returns original prompt when no logs", async () => {
  await withTempDevLogsDir(async () => {
    const result = await buildPromptWithDevLogs("www", "Only prompt");
    assert.equal(result.logsAttached, false);
    assert.equal(result.prompt, "Only prompt");
  });
});
