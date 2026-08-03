import {
  getDb,
  getTelegramTopicByAgentId,
  getTelegramTopicBySessionId,
  getTelegramTopicByThreadId,
  listTelegramTopics,
  upsertTelegramTopic,
} from "./db.js";
import {
  getTelegramChatId,
  getTelegramTopicMap,
  telegramApi,
} from "./telegram.js";

/**
 * @typedef {{
 *   threadId: number,
 *   sessionId: string,
 *   agentId: string,
 *   project: string,
 *   name: string,
 *   createdAt: number,
 * }} TopicBinding
 */

function agentTopicsEnabled() {
  return process.env.TELEGRAM_AGENT_TOPICS !== "0";
}

function loadStoreShape() {
  const byThreadId = {};
  const bySessionId = {};
  for (const binding of listTelegramTopics()) {
    byThreadId[String(binding.threadId)] = binding;
    bySessionId[binding.sessionId] = binding.threadId;
  }
  return { byThreadId, bySessionId };
}

/** Telegram forum topic titles are limited to 128 chars. */
export function formatAgentTopicName(project, name) {
  const projectPart = String(project || "agent").slice(0, 32);
  const title = String(name || "New session")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  const combined = `${projectPart} · ${title}`;
  return combined.slice(0, 128);
}

/**
 * @param {number} threadId
 * @returns {TopicBinding|null}
 */
export function getBindingByThreadId(threadId) {
  if (threadId == null) return null;
  return getTelegramTopicByThreadId(threadId);
}

/**
 * @param {string} sessionId
 * @returns {TopicBinding|null}
 */
export function getBindingBySessionId(sessionId) {
  if (!sessionId) return null;
  return getTelegramTopicBySessionId(sessionId);
}

/**
 * @param {string} agentId
 * @returns {TopicBinding|null}
 */
export function getBindingByAgentId(agentId) {
  if (!agentId) return null;
  return getTelegramTopicByAgentId(agentId);
}

/**
 * Resolve static project topic label OR dynamic agent binding.
 * @returns {{ kind: 'status'|'project'|'agent'|'unknown', label: string|null, binding: TopicBinding|null }}
 */
export function resolveTelegramThread(threadId) {
  if (threadId == null) {
    return { kind: "unknown", label: "general", binding: null };
  }

  const map = getTelegramTopicMap();
  for (const [label, id] of Object.entries(map)) {
    if (id != null && id === threadId) {
      if (label === "status") {
        return { kind: "status", label: "status", binding: null };
      }
      return { kind: "project", label, binding: null };
    }
  }

  const binding = getBindingByThreadId(threadId);
  if (binding) {
    return { kind: "agent", label: binding.project, binding };
  }

  return { kind: "unknown", label: null, binding: null };
}

/**
 * Create (or reuse) a forum topic for an agent session.
 * @param {{ sessionId: string, agentId: string, project: string, name?: string }} session
 * @returns {Promise<TopicBinding|null>}
 */
export async function ensureAgentTelegramTopic(session) {
  if (!agentTopicsEnabled()) return null;
  if (!getTelegramChatId()) return null;

  const bySession = getBindingBySessionId(session.sessionId);
  if (bySession) return bySession;

  // Reuse topic if this IDE/SDK agent was mirrored before (new bridge session).
  const byAgent = getBindingByAgentId(session.agentId);
  if (byAgent) {
    const updated = {
      ...byAgent,
      sessionId: session.sessionId,
      project: session.project || byAgent.project,
      name: session.name
        ? formatAgentTopicName(session.project, session.name)
        : byAgent.name,
    };
    upsertTelegramTopic(updated);
    return updated;
  }

  const name = formatAgentTopicName(session.project, session.name);
  const chatId = getTelegramChatId();

  try {
    const topic = await telegramApi("createForumTopic", {
      chat_id: chatId,
      name,
    });
    const threadId = topic?.message_thread_id;
    if (threadId == null) {
      console.warn("[telegram-topics] createForumTopic missing thread id", topic);
      return null;
    }

    /** @type {TopicBinding} */
    const binding = {
      threadId: Number(threadId),
      sessionId: session.sessionId,
      agentId: session.agentId,
      project: session.project,
      name,
      createdAt: Date.now(),
    };

    upsertTelegramTopic(binding);
    return binding;
  } catch (err) {
    console.warn(
      "[telegram-topics] createForumTopic failed:",
      err?.message || err,
    );
    return null;
  }
}

/**
 * Rename an agent topic after the agent gets a real title.
 * @param {string} sessionId
 * @param {string} project
 * @param {string} name
 */
export async function renameAgentTelegramTopic(sessionId, project, name) {
  if (!agentTopicsEnabled()) return null;
  const binding = getBindingBySessionId(sessionId);
  if (!binding) return null;

  const nextName = formatAgentTopicName(project, name);
  if (nextName === binding.name) return binding;

  try {
    await telegramApi("editForumTopic", {
      chat_id: getTelegramChatId(),
      message_thread_id: binding.threadId,
      name: nextName,
    });
    const updated = { ...binding, name: nextName };
    upsertTelegramTopic(updated);
    return updated;
  } catch (err) {
    console.warn(
      "[telegram-topics] editForumTopic failed:",
      err?.message || err,
    );
    return binding;
  }
}

/** Test helpers */
export function _resetTelegramTopicStoreForTests() {
  getDb().prepare(`DELETE FROM telegram_topics`).run();
}

/** @param {TopicBinding} binding */
export function _registerBindingForTests(binding) {
  upsertTelegramTopic(binding);
}

export { loadStoreShape as _loadTelegramTopicStoreForTests };
