import fs from "fs";
import path from "path";
import {
  getTelegramChatId,
  getTelegramTopicMap,
  telegramApi,
} from "./telegram.js";

const STORE_PATH = path.resolve(
  process.env.TELEGRAM_TOPIC_STORE ??
    path.join(process.env.HOME || "", ".cursor-bridge", "telegram-agent-topics.json"),
);

/** @type {{ byThreadId: Record<string, TopicBinding>, bySessionId: Record<string, number> }} */
let cache = null;

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

function loadStore() {
  if (cache) return cache;
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
      cache = {
        byThreadId: raw.byThreadId || {},
        bySessionId: raw.bySessionId || {},
      };
      return cache;
    }
  } catch (err) {
    console.warn("[telegram-topics] failed to load store:", err?.message || err);
  }
  cache = { byThreadId: {}, bySessionId: {} };
  return cache;
}

function saveStore() {
  const store = loadStore();
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  } catch (err) {
    console.warn("[telegram-topics] failed to save store:", err?.message || err);
  }
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
  const store = loadStore();
  return store.byThreadId[String(threadId)] || null;
}

/**
 * @param {string} sessionId
 * @returns {TopicBinding|null}
 */
export function getBindingBySessionId(sessionId) {
  if (!sessionId) return null;
  const store = loadStore();
  const threadId = store.bySessionId[sessionId];
  if (threadId == null) return null;
  return store.byThreadId[String(threadId)] || null;
}

/**
 * @param {string} agentId
 * @returns {TopicBinding|null}
 */
export function getBindingByAgentId(agentId) {
  if (!agentId) return null;
  const store = loadStore();
  for (const binding of Object.values(store.byThreadId)) {
    if (binding?.agentId === agentId) return binding;
  }
  return null;
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
    byAgent.sessionId = session.sessionId;
    byAgent.project = session.project || byAgent.project;
    if (session.name) {
      byAgent.name = formatAgentTopicName(session.project, session.name);
    }
    const store = loadStore();
    store.byThreadId[String(byAgent.threadId)] = byAgent;
    store.bySessionId[session.sessionId] = byAgent.threadId;
    saveStore();
    return byAgent;
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

    const store = loadStore();
    store.byThreadId[String(binding.threadId)] = binding;
    store.bySessionId[session.sessionId] = binding.threadId;
    saveStore();

    await telegramApi("sendMessage", {
      chat_id: chatId,
      message_thread_id: binding.threadId,
      text: `Mirroring **${session.project}** agent.\nSend follow-ups here.\n\`${String(session.agentId).slice(0, 12)}…\``,
      parse_mode: "Markdown",
    }).catch(() => {});

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
    binding.name = nextName;
    const store = loadStore();
    store.byThreadId[String(binding.threadId)] = binding;
    saveStore();
    return binding;
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
  cache = { byThreadId: {}, bySessionId: {} };
}

/** @param {TopicBinding} binding */
export function _registerBindingForTests(binding) {
  const store = loadStore();
  store.byThreadId[String(binding.threadId)] = binding;
  store.bySessionId[binding.sessionId] = binding.threadId;
}
