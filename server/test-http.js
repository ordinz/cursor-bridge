import express from "express";
import { createRouter } from "./routes.js";
import { SessionManager } from "./sessions.js";
import { persistSessionRecord } from "./db.js";
import { useTempBridgeDb } from "./test-db.js";

export function createTestApp() {
  useTempBridgeDb();
  const sessions = new SessionManager();
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  app.use("/api", createRouter(sessions));
  return { app, sessions };
}

export async function withTestServer(fn) {
  const { app, sessions } = createTestApp();
  const http = await import("node:http");
  const { attachSessionWebSocket } = await import("./session-ws.js");
  const server = http.createServer(app);
  attachSessionWebSocket(server, sessions);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api`;
  const wsBase = `ws://127.0.0.1:${port}/api`;

  try {
    await fn({ sessions, base, wsBase, server });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function persistSeed(record) {
  persistSessionRecord(record);
}

export function seedRunningSession(sessions, id = "11111111-1111-4111-8111-111111111111") {
  const record = {
    sessionId: id,
    agent: { send: async () => { throw new Error("not mocked"); } },
    agentId: "agent-test",
    project: "app",
    cwd: "/tmp/app",
    model: "default",
    mode: "agent",
    name: "test",
    namedFromPrompt: true,
    namingScheduled: false,
    telegramThreadId: null,
    activeRun: { supports: () => true, cancel: async () => {} },
    abortController: null,
    runStatus: "running",
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    listActivityAt: Date.now(),
    lastPrompt: "hi",
    lastAssistantSnippet: null,
    closedAt: null,
  };
  sessions.sessions.set(id, record);
  persistSeed(record);
  return id;
}

export function seedIdleSession(sessions, id = "22222222-2222-4222-8222-222222222222") {
  const record = {
    sessionId: id,
    agent: {
      send: async () => ({
        supports: (op) => op === "cancel",
        cancel: async () => {},
        stream: async function* () {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: "Hello" }] },
          };
        },
        wait: async () => ({ id: "run-1", status: "finished" }),
      }),
    },
    agentId: "agent-idle",
    project: "app",
    cwd: "/tmp/app",
    model: "default",
    mode: "agent",
    name: "idle",
    namedFromPrompt: true,
    namingScheduled: false,
    telegramThreadId: null,
    activeRun: null,
    abortController: null,
    runStatus: "idle",
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    listActivityAt: Date.now(),
    lastPrompt: null,
    lastAssistantSnippet: null,
    closedAt: null,
  };
  sessions.sessions.set(id, record);
  persistSeed(record);
  return id;
}
