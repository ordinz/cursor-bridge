import test from "node:test";
import assert from "node:assert/strict";
import { matchesApiKey, readRemoteApiKey, requireRemoteApiKey } from "./remote-auth.js";

const savedMcpKey = process.env.MCP_API_KEY;
const savedBridgeKey = process.env.BRIDGE_API_KEY;

test.afterEach(() => {
  if (savedMcpKey === undefined) delete process.env.MCP_API_KEY;
  else process.env.MCP_API_KEY = savedMcpKey;
  if (savedBridgeKey === undefined) delete process.env.BRIDGE_API_KEY;
  else process.env.BRIDGE_API_KEY = savedBridgeKey;
});

function runMiddleware(headers, onNext = () => {}) {
  let statusCode = 200;
  let body;
  let nextCalled = false;
  const req = { headers, path: "/api/health", method: "GET" };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };
  requireRemoteApiKey(req, res, () => {
    nextCalled = true;
    onNext();
  });
  return { statusCode, body, nextCalled };
}

test("readRemoteApiKey prefers BRIDGE_API_KEY over MCP_API_KEY", () => {
  const prevBridge = process.env.BRIDGE_API_KEY;
  const prevMcp = process.env.MCP_API_KEY;
  process.env.BRIDGE_API_KEY = "bridge-key";
  process.env.MCP_API_KEY = "mcp-key";
  assert.equal(readRemoteApiKey(), "bridge-key");
  process.env.BRIDGE_API_KEY = prevBridge;
  process.env.MCP_API_KEY = prevMcp;
});

test("matchesApiKey accepts Bearer and raw token forms", () => {
  const req = (authorization) => ({ headers: { authorization } });
  assert.equal(matchesApiKey(req("Bearer secret"), "secret"), true);
  assert.equal(matchesApiKey(req("secret"), "secret"), true);
  assert.equal(matchesApiKey(req("Bearer=secret"), "secret"), true);
  assert.equal(matchesApiKey(req("Bearer wrong"), "secret"), false);
});

test("requireRemoteApiKey allows localhost without key", () => {
  delete process.env.MCP_API_KEY;
  delete process.env.BRIDGE_API_KEY;
  const result = runMiddleware({ host: "127.0.0.1:4242" });
  assert.equal(result.nextCalled, true);
});

test("requireRemoteApiKey rejects remote host without key", () => {
  delete process.env.MCP_API_KEY;
  delete process.env.BRIDGE_API_KEY;
  const result = runMiddleware({ host: "tunnel.example.com" });
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.code, "REMOTE_ACCESS_DISABLED");
});

test("requireRemoteApiKey rejects remote host with wrong key", () => {
  process.env.MCP_API_KEY = "good-key";
  const result = runMiddleware({
    host: "tunnel.example.com",
    authorization: "Bearer bad-key",
  });
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.code, "UNAUTHORIZED");
});

test("requireRemoteApiKey accepts remote host with valid Bearer key", () => {
  process.env.MCP_API_KEY = "good-key";
  const result = runMiddleware({
    host: "tunnel.example.com",
    authorization: "Bearer good-key",
  });
  assert.equal(result.nextCalled, true);
});
