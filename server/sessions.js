import crypto from "crypto";
import { Agent } from "@cursor/sdk";
import { resolveProject, ProjectError } from "./projects.js";
import { buildAgentName } from "./agent-names.js";
import { getLocalAgentMeta } from "./agents.js";

const IDLE_TIMEOUT_MS = Number(process.env.SESSION_IDLE_MS ?? 30 * 60 * 1000);

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

  async create({ project, model = "default" }) {
    const cwd = resolveProject(project);
    const sessionId = this.createId();
    const name = buildAgentName({ project, model });

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
      runStatus: "idle",
      lastActivityAt: Date.now(),
    };

    this.sessions.set(sessionId, record);
    this.scheduleIdleCleanup(sessionId);
    return toPublicSession(record);
  }

  async resumeAgent({ agentId, project, model = "default" }) {
    const cwd = resolveProject(project);
    const sessionId = this.createId();
    const { name: storedName, namedFromPrompt } = await getLocalAgentMeta(
      agentId,
      project,
    );

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
      runStatus: "idle",
      lastActivityAt: Date.now(),
    };

    this.sessions.set(sessionId, record);
    this.scheduleIdleCleanup(sessionId);
    return toPublicSession(record);
  }

  markNamedFromPrompt(sessionId, name) {
    const record = this.get(sessionId);
    if (!record) return;
    record.name = name;
    record.namedFromPrompt = true;
  }

  setActiveRun(sessionId, run) {
    const record = this.get(sessionId);
    if (!record) return;
    record.activeRun = run;
    record.runStatus = "running";
    record.lastActivityAt = Date.now();
  }

  clearActiveRun(sessionId, status = "idle") {
    const record = this.get(sessionId);
    if (!record) return;
    record.activeRun = null;
    record.runStatus = status;
    record.lastActivityAt = Date.now();
  }

  touch(sessionId) {
    const record = this.get(sessionId);
    if (record) {
      record.lastActivityAt = Date.now();
    }
  }

  async cancel(sessionId) {
    const record = this.get(sessionId);
    if (!record) return false;

    if (record.activeRun?.supports("cancel")) {
      await record.activeRun.cancel();
      this.clearActiveRun(sessionId, "cancelled");
      return true;
    }

    return false;
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
  };
}

export { ProjectError };
