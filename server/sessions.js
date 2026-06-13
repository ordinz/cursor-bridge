import crypto from "crypto";
import { Agent } from "@cursor/sdk";
import { resolveProject, ProjectError } from "./projects.js";
import { buildAgentName } from "./agent-names.js";
import { getLocalAgentMeta } from "./agents.js";
import {
  NoActiveRunError,
  SessionBusyError,
  SessionNotFoundError,
} from "./errors.js";

const IDLE_TIMEOUT_MS = Number(process.env.SESSION_IDLE_MS ?? 30 * 60 * 1000);
const SNIPPET_MAX = 160;

export class SessionManager {
  constructor() {
    /** @type {Map<string, SessionRecord>} */
    this.sessions = new Map();
  }

  createId() {
    return crypto.randomUUID();
  }

  get(sessionId) {
    return this.sessions.get(sessionId) ?? null;
  }

  list() {
    return [...this.sessions.values()].map(toPublicSession);
  }

  getDetail(sessionId) {
    const record = this.get(sessionId);
    if (!record) return null;
    return toSessionDetail(record);
  }

  /** @throws {SessionNotFoundError} */
  require(sessionId) {
    const record = this.get(sessionId);
    if (!record) {
      throw new SessionNotFoundError(sessionId);
    }
    return record;
  }

  isRunActive(sessionId) {
    const record = this.get(sessionId);
    return Boolean(record?.runStatus === "running" && record.activeRun);
  }

  /** @throws {SessionNotFoundError | SessionBusyError} */
  assertCanChat(sessionId) {
    const record = this.get(sessionId);
    if (!record) {
      throw new SessionNotFoundError(sessionId);
    }
    if (record.runStatus === "running") {
      throw new SessionBusyError(sessionId);
    }
    return record;
  }

  async create({ project, model = "default" }) {
    const cwd = resolveProject(project);
    const sessionId = this.createId();
    const name = buildAgentName({ project, model });
    const now = Date.now();

    const agent = await Agent.create({
      apiKey: process.env.CURSOR_API_KEY,
      name,
      model: { id: model },
      local: { cwd },
    });

    const record = {
      sessionId,
      agent,
      agentId: agent.agentId,
      project,
      cwd,
      model,
      name,
      namedFromPrompt: false,
      activeRun: null,
      abortController: null,
      runStatus: "idle",
      createdAt: now,
      lastActivityAt: now,
      lastPrompt: null,
      lastAssistantSnippet: null,
    };

    this.sessions.set(sessionId, record);
    this.scheduleIdleCleanup(sessionId);
    return toSessionDetail(record);
  }

  async resumeAgent({ agentId, project, model = "default" }) {
    const cwd = resolveProject(project);
    const sessionId = this.createId();
    const { name: storedName, namedFromPrompt } = await getLocalAgentMeta(
      agentId,
      project,
    );
    const now = Date.now();

    const agent = await Agent.resume(agentId, {
      apiKey: process.env.CURSOR_API_KEY,
      model: { id: model },
      local: { cwd },
    });

    const record = {
      sessionId,
      agent,
      agentId: agent.agentId,
      project,
      cwd,
      model,
      name: storedName ?? buildAgentName({ project, model }),
      namedFromPrompt,
      activeRun: null,
      abortController: null,
      runStatus: "idle",
      createdAt: now,
      lastActivityAt: now,
      lastPrompt: null,
      lastAssistantSnippet: null,
    };

    this.sessions.set(sessionId, record);
    this.scheduleIdleCleanup(sessionId);
    return toSessionDetail(record);
  }

  markNamedFromPrompt(sessionId, name) {
    const record = this.get(sessionId);
    if (!record) return;
    record.name = name;
    record.namedFromPrompt = true;
    record.lastActivityAt = Date.now();
  }

  notePrompt(sessionId, prompt) {
    const record = this.get(sessionId);
    if (!record) return;
    record.lastPrompt = prompt;
    record.lastActivityAt = Date.now();
  }

  noteAssistantText(sessionId, text) {
    const record = this.get(sessionId);
    if (!record || !text) return;
    const combined = `${record.lastAssistantSnippet ?? ""}${text}`;
    record.lastAssistantSnippet =
      combined.length > SNIPPET_MAX
        ? `${combined.slice(-SNIPPET_MAX)}`
        : combined;
    record.lastActivityAt = Date.now();
  }

  setActiveRun(sessionId, run, abortController = null) {
    const record = this.get(sessionId);
    if (!record) return;
    record.activeRun = run;
    record.abortController = abortController;
    record.runStatus = "running";
    record.lastActivityAt = Date.now();
  }

  clearActiveRun(sessionId, status = "idle") {
    const record = this.get(sessionId);
    if (!record) return;
    record.activeRun = null;
    record.abortController = null;
    record.runStatus = status;
    record.lastActivityAt = Date.now();
  }

  touch(sessionId) {
    const record = this.get(sessionId);
    if (record) {
      record.lastActivityAt = Date.now();
    }
  }

  /** @throws {SessionNotFoundError | NoActiveRunError} */
  async cancel(sessionId) {
    const record = this.require(sessionId);

    if (!record.activeRun) {
      throw new NoActiveRunError(sessionId);
    }

    record.abortController?.abort();

    if (record.activeRun.supports?.("cancel")) {
      await record.activeRun.cancel();
    }

    this.clearActiveRun(sessionId, "cancelled");
    return { sessionId, runStatus: "cancelled" };
  }

  async close(sessionId) {
    const record = this.get(sessionId);
    if (!record) return false;

    if (record.activeRun?.supports("cancel")) {
      try {
        await record.activeRun.cancel();
      } catch {
        // ignore cancel errors during close
      }
    }

    record.agent.close();
    this.sessions.delete(sessionId);
    return true;
  }

  async closeByAgentId(agentId) {
    for (const [sessionId, record] of this.sessions) {
      if (record.agentId === agentId) {
        await this.close(sessionId);
        return sessionId;
      }
    }
    return null;
  }

  scheduleIdleCleanup(sessionId) {
    setTimeout(async () => {
      const record = this.get(sessionId);
      if (!record) return;
      if (Date.now() - record.lastActivityAt >= IDLE_TIMEOUT_MS) {
        await this.close(sessionId);
      } else {
        this.scheduleIdleCleanup(sessionId);
      }
    }, IDLE_TIMEOUT_MS);
  }
}

function toPublicSession(record) {
  return {
    sessionId: record.sessionId,
    agentId: record.agentId,
    project: record.project,
    cwd: record.cwd,
    model: record.model,
    name: record.name,
    runStatus: record.runStatus,
    runActive: Boolean(record.activeRun),
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
    lastPrompt: record.lastPrompt,
    lastAssistantSnippet: record.lastAssistantSnippet,
  };
}

function toSessionDetail(record) {
  return {
    ...toPublicSession(record),
    namedFromPrompt: record.namedFromPrompt,
  };
}

export { ProjectError };
