import test from "node:test";
import assert from "node:assert/strict";
import { isAgentArchivedError, isAgentBusyError } from "./agents.js";

test("isAgentBusyError matches Cursor busy messages", () => {
  assert.equal(
    isAgentBusyError(new Error("Agent already has an active run")),
    true,
  );
  assert.equal(isAgentBusyError(new Error("something else")), false);
});

test("isAgentArchivedError matches Cursor archive block", () => {
  assert.equal(
    isAgentArchivedError(
      new Error(
        "Cannot create follow-up run on archived agent agent-afbb2e54. Unarchive it first.",
      ),
    ),
    true,
  );
  assert.equal(isAgentArchivedError(new Error("run failed")), false);
  assert.equal(
    isAgentArchivedError(new Error("Agent already has an active run")),
    false,
  );
});
