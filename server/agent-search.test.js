import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesAgentQuery,
  searchLocalAgents,
  SEARCH_PAGE_SIZE,
} from "./agent-search.js";
import { BRIDGE_NAMING_AGENT_NAME } from "./agent-names.js";

test("matchesAgentQuery checks name, summary, and id", () => {
  assert.equal(
    matchesAgentQuery(
      { name: "Fix login", summary: "auth", agentId: "abc-123" },
      "login",
    ),
    true,
  );
  assert.equal(
    matchesAgentQuery(
      { name: "Fix login", summary: "auth", agentId: "abc-123" },
      "AUTH",
    ),
    true,
  );
  assert.equal(
    matchesAgentQuery(
      { name: "Fix login", summary: "auth", agentId: "abc-123" },
      "abc-12",
    ),
    true,
  );
  assert.equal(
    matchesAgentQuery(
      { name: "Fix login", summary: "auth", agentId: "abc-123" },
      "missing",
    ),
    false,
  );
  assert.equal(matchesAgentQuery({ name: "x", agentId: "1" }, "  "), true);
});

test("searchLocalAgents walks pages and returns only matches", async () => {
  const pages = [
    {
      items: [
        { agentId: "a1", name: "Alpha", lastModified: 3 },
        { agentId: "a2", name: "Beta", lastModified: 2 },
        { agentId: "name", name: BRIDGE_NAMING_AGENT_NAME, lastModified: 9 },
      ],
      nextCursor: "c1",
    },
    {
      items: [
        { agentId: "a3", name: "Alpha two", lastModified: 4 },
        { agentId: "a4", name: "Gamma", archived: true, lastModified: 5 },
      ],
      nextCursor: null,
    },
  ];
  let calls = 0;
  const list = async (opts) => {
    calls += 1;
    assert.equal(opts.runtime, "local");
    assert.equal(opts.cwd, "/tmp/app");
    assert.equal(opts.limit, SEARCH_PAGE_SIZE);
    if (calls === 1) {
      assert.equal(opts.cursor, undefined);
      return pages[0];
    }
    assert.equal(opts.cursor, "c1");
    return pages[1];
  };

  const result = await searchLocalAgents({
    list,
    cwd: "/tmp/app",
    query: "alpha",
  });

  assert.equal(calls, 2);
  assert.equal(result.exhausted, true);
  assert.equal(result.nextCursor, null);
  assert.deepEqual(
    result.agents.map((a) => a.agentId),
    ["a3", "a1"],
  );
});

test("searchLocalAgents can include archived matches", async () => {
  const list = async () => ({
    items: [
      { agentId: "a1", name: "Keep", archived: true, lastModified: 1 },
      { agentId: "a2", name: "Other", lastModified: 2 },
    ],
    nextCursor: null,
  });

  const hidden = await searchLocalAgents({
    list,
    cwd: "/tmp",
    query: "keep",
    includeArchived: false,
  });
  assert.equal(hidden.agents.length, 0);

  const shown = await searchLocalAgents({
    list,
    cwd: "/tmp",
    query: "keep",
    includeArchived: true,
  });
  assert.equal(shown.agents.length, 1);
  assert.equal(shown.agents[0].agentId, "a1");
});
