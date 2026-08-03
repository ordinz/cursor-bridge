import crypto from "crypto";
import { Agent } from "@cursor/sdk";
import { resolveProject, ProjectError } from "./projects.js";
import { buildAgentName } from "./agent-names.js";
import { ensureAgentUnarchived, getLocalAgentMeta } from "./agents.js";
import {
  NoActiveRunError,
  SessionBusyError,
  SessionNotFoundError,
} from "./errors.js";
import { SessionEventHub } from "./session-events.js";
import { telegramTopicUrlForSession } from "./telegram-deeplinks.js";
import { getBindingByAgentId } from "./telegram-topics.js";
import {
  bumpConversationSort,
  markConversationCompleted,
} from "./conversation-reads.js";

const IDLE_TIMEOUT_MS = Number(process.env.SESSION_IDLE_MS ?? 30 * 60 * 1000);
const SNIPPET_MAX = 160;

export class SessionManager {
  constructor() {
    /** @type {Map<string, SessionRecord>} */
    this.sessions = new Map();
    this.events = new SessionEventHub();
  }

  /** @param {object} event @param {import("express").Response} [chatRes] */
  publishEvent(sessionId, event, chatRes) {
    this.events.publish(sessionId, event, chatRes);
  }

  startRunEvents(sessionId) {
    this.events.startRun(sessionId);
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

  /** Latest in-memory session for a project, or null. */
  findLatestForProject(project) {
    let best = null;
    for (const record of this.sessions.values()) {
      if (record.project !== project) continue;
      if (!best || record.lastActivityAt > best.lastActivityAt) {
        best = record;
      }
    }
    return best ? toSessionDetail(best) : null;
  }

  /** Active (running) sessions, optionally filtered by project. */
  listActiveRuns(project = null) {
    return this.list().filter(
      (s) =>
        s.runActive &&
        (project == null || s.project === project),
    );
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

  countActiveRuns() {
    let count = 0;
    for (const record of this.sessions.values()) {
      if (record.runStatus === "running" && record.activeRun) count++;
    }
    return count;
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

  async create({ project, model = "default", mode = "agent" }) {
    const cwd = resolveProject(project);
    const sessionId = this.createId();
    const name = buildAgentName({ project, model });
    const now = Date.now();
    const agentMode = mode === "plan" ? "plan" : "agent";

    const agent = await Agent.create({
      apiKey: process.env.CURSOR_API_KEY,
      name,
      model: { id: model },
      mode: agentMode,
      local: { cwd },
    });

    const record = {
      sessionId,
      agent,
      agentId: agent.agentId,
      project,
      cwd,
      model,
      mode: agentMode,
      name,
      namedFromPrompt: false,
      namingScheduled: false,
      telegramThreadId: null,
      activeRun: null,
      abortController: null,
      runStatus: "idle",
      createdAt: now,
      lastActivityAt: now,
      /** Stable list ordering — not bumped by streaming assistant chunks. */
      listActivityAt: now,
      lastPrompt: null,
      lastAssistantSnippet: null,
    };

    this.sessions.set(sessionId, record);
    bumpConversationSort(project, agent.agentId, now);
    this.scheduleIdleCleanup(sessionId);
    return toSessionDetail(record);
  }

  setTelegramThreadId(sessionId, threadId) {
    const record = this.get(sessionId);
    if (!record) return;
    record.telegramThreadId =
      threadId == null ? null : Number(threadId);
    record.lastActivityAt = Date.now();
  }

  async resumeAgent({ agentId, project, model = "default", mode = "agent" }) {
    const cwd = resolveProject(project);
    const sessionId = this.createId();
    const { name: storedName, namedFromPrompt } = await getLocalAgentMeta(
      agentId,
      project,
    );
    const now = Date.now();
    const agentMode = mode === "plan" ? "plan" : "agent";

    // Opening an archived chat means continue it — bring it back to the active list.
    try {
      await ensureAgentUnarchived(agentId, cwd);
    } catch {
      // sendAgentMessage still recovers if the store stays archived.
    }

    const agent = await Agent.resume(agentId, {
      apiKey: process.env.CURSOR_API_KEY,
      model: { id: model },
      mode: agentMode,
      local: { cwd },
    });

    const binding = getBindingByAgentId(agent.agentId);
    const record = {
      sessionId,
      agent,
      agentId: agent.agentId,
      project,
      cwd,
      model,
      mode: agentMode,
      name: storedName ?? buildAgentName({ project, model }),
      namedFromPrompt,
      namingScheduled: false,
      telegramThreadId: binding?.threadId ?? null,
      activeRun: null,
      abortController: null,
      runStatus: "idle",
      createdAt: now,
      lastActivityAt: now,
      // Opening/resuming must not reshuffle the Recent list.
      listActivityAt: 0,
      lastPrompt: null,
      lastAssistantSnippet: null,
    };

    this.sessions.set(sessionId, record);
    this.scheduleIdleCleanup(sessionId);
    return toSessionDetail(record);
  }

  /** @param {string} sessionId @param {string} model */
  setModel(sessionId, model) {
    const record = this.get(sessionId);
    if (!record || typeof model !== "string" || !model.trim()) return;
    record.model = model.trim();
    record.lastActivityAt = Date.now();
  }

  /** @param {string} sessionId @param {"agent"|"plan"} mode */
  setMode(sessionId, mode) {
    const record = this.get(sessionId);
    if (!record) return;
    record.mode = mode === "plan" ? "plan" : "agent";
    record.lastActivityAt = Date.now();
  }

  setInterimName(sessionId, name) {
    const record = this.get(sessionId);
    if (!record || record.namedFromPrompt) return;
    record.name = name;
    record.lastActivityAt = Date.now();
  }

  scheduleNaming(sessionId) {
    const record = this.get(sessionId);
    if (!record || record.namedFromPrompt || record.namingScheduled) {
      return false;
    }
    record.namingScheduled = true;
    return true;
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
    const now = Date.now();
    record.lastPrompt = prompt;
    record.lastAssistantSnippet = null;
    record.lastActivityAt = now;
    record.listActivityAt = now;
    bumpConversationSort(record.project, record.agentId, now);
  }

  noteAssistantText(sessionId, text) {
    const record = this.get(sessionId);
    if (!record || !text) return;
    const combined = `${record.lastAssistantSnippet ?? ""}${text}`;
    record.lastAssistantSnippet =
      combined.length > SNIPPET_MAX
        ? `${combined.slice(-SNIPPET_MAX)}`
        : combined;
    // Keep idle timeout alive, but do not reshuffle Recent ordering.
    record.lastActivityAt = Date.now();
  }

  setActiveRun(sessionId, run, abortController = null) {
    const record = this.get(sessionId);
    if (!record) return;
    const now = Date.now();
    record.activeRun = run;
    record.abortController = abortController;
    record.runStatus = "running";
    record.lastActivityAt = now;
    record.listActivityAt = now;
    bumpConversationSort(record.project, record.agentId, now);
  }

  clearActiveRun(sessionId, status = "idle") {
    const record = this.get(sessionId);
    if (!record) return;
    const now = Date.now();
    record.activeRun = null;
    record.abortController = null;
    record.runStatus = status;
    record.lastActivityAt = now;
    record.listActivityAt = now;
    if (status === "idle" || status === "finished" || status === "error") {
      markConversationCompleted(record.project, record.agentId, now);
    } else {
      bumpConversationSort(record.project, record.agentId, now);
    }
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
    this.events.removeSession(sessionId);
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
  const telegramThreadId =
    record.telegramThreadId ??
    getBindingByAgentId(record.agentId)?.threadId ??
    null;
  const withThread = { ...record, telegramThreadId };
  return {
    sessionId: record.sessionId,
    agentId: record.agentId,
    project: record.project,
    cwd: record.cwd,
    model: record.model,
    mode: record.mode === "plan" ? "plan" : "agent",
    name: record.name,
    telegramThreadId,
    telegramTopicUrl: telegramTopicUrlForSession(withThread),
    runStatus: record.runStatus,
    runActive: Boolean(record.activeRun),
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
    listActivityAt: record.listActivityAt || 0,
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
