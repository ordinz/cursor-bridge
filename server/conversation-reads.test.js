import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, before, beforeEach } from "node:test";

const tmpFile = path.join(
  os.tmpdir(),
  `cursor-bridge-conversation-reads-${process.pid}.json`,
);
process.env.CONVERSATION_READS_FILE = tmpFile;

const {
  _resetConversationReadsForTests,
  bumpConversationSort,
  getConversationRead,
  listConversationReads,
  markConversationCompleted,
  markConversationRead,
  removeConversationRead,
} = await import("./conversation-reads.js");

describe("conversation-reads", () => {
  before(() => {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    _resetConversationReadsForTests({ byKey: {} });
  });

  it("marks completed as unread until read", () => {
    markConversationCompleted("app", "agent-1", 1000);
    const before = getConversationRead("app", "agent-1");
    assert.equal(before.lastCompletedAt, 1000);
    assert.equal(before.lastReadAt, 0);
    assert.ok(before.lastCompletedAt > before.lastReadAt);

    markConversationRead("app", "agent-1");
    const after = getConversationRead("app", "agent-1");
    assert.ok(after.lastReadAt >= after.lastCompletedAt);
  });

  it("bumps sort without clearing unread", () => {
    markConversationCompleted("app", "agent-1", 1000);
    bumpConversationSort("app", "agent-1", 2000);
    const entry = getConversationRead("app", "agent-1");
    assert.equal(entry.lastSortAt, 2000);
    assert.equal(entry.lastCompletedAt, 1000);
    assert.equal(entry.lastReadAt, 0);
  });

  it("lists and removes entries", () => {
    markConversationCompleted("app", "a", 1);
    markConversationCompleted("web", "b", 2);
    assert.equal(Object.keys(listConversationReads()).length, 2);
    removeConversationRead("app", "a");
    assert.deepEqual(Object.keys(listConversationReads()), ["web:b"]);
  });
});
