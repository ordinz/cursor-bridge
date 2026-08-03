import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { useTempBridgeDb } from "./test-db.js";

useTempBridgeDb();

const {
  _resetIdeMirrorStateForTests,
  getIdeMirrorStatus,
  stopIdeAgentMirror,
} = await import("./telegram-ide-mirror.js");

before(() => {
  useTempBridgeDb();
  _resetIdeMirrorStateForTests();
});

after(() => {
  _resetIdeMirrorStateForTests();
});

test("getIdeMirrorStatus reports stopped by default", () => {
  stopIdeAgentMirror();
  const status = getIdeMirrorStatus();
  assert.equal(status.running, false);
  assert.equal(status.streamingRuns, 0);
  assert.ok(status.pollMs > 0);
});
