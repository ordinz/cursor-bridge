import express from "express";
import { createRouter } from "./routes.js";
import { SessionManager } from "./sessions.js";

export function createTestApp() {
  const sessions = new SessionManager();
  const app = express();
  app.use(express.json());
  app.use("/api", createRouter(sessions));
  return { app, sessions };
}

export async function withTestServer(fn) {
  const { app, sessions } = createTestApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api`;

  try {
    await fn({ sessions, base, server });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

export function seedRunningSession(sessions, id = "11111111-1111-4111-8111-111111111111") {
  sessions.sessions.set(id, {
    sessionId: id,
    agent: { send: async () => { throw new Error("not mocked"); } },
    agentId: "agent-test",
    project: "app",
    cwd: "/tmp/app",
    model: "default",
    name: "test",
    namedFromPrompt: true,
    activeRun: { supports: () => true, cancel: async () => {} },
    abortController: null,
    runStatus: "running",
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    lastPrompt: "hi",
    lastAssistantSnippet: null,
  });
  return id;
}

export function seedIdleSession(sessions, id = "22222222-2222-4222-8222-222222222222") {
  sessions.sessions.set(id, {
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
    name: "idle",
    namedFromPrompt: true,
    activeRun: null,
    abortController: null,
    runStatus: "idle",
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    lastPrompt: null,
    lastAssistantSnippet: null,
  });
  return id;
}
