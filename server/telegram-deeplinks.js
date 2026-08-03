import { getTelegramChatId } from "./telegram.js";
import { getBindingByAgentId } from "./telegram-topics.js";

const DEFAULT_BRIDGE_UI_ORIGIN = "https://ordins-cursor-bridge.kairose.com";

/**
 * Public oversight UI origin for Telegram → web deep links.
 * Cloudflare tunnel → Vite :5173 by default.
 */
export function bridgeUiOrigin() {
  const raw = process.env.BRIDGE_UI_ORIGIN?.trim();
  if (raw) return raw.replace(/\/$/, "");
  return DEFAULT_BRIDGE_UI_ORIGIN;
}

/**
 * Strip Telegram's -100 prefix so t.me/c/<id>/… links work for private forums.
 * @param {string|number} chatId
 * @returns {string|null}
 */
export function telegramInternalChatId(chatId) {
  if (chatId == null || chatId === "") return null;
  const s = String(chatId).trim();
  if (!s) return null;
  if (s.startsWith("-100")) return s.slice(4);
  if (s.startsWith("-")) return s.slice(1);
  return s;
}

/**
 * Open a forum topic (or a specific message) in Telegram.
 * @param {string|number} chatId
 * @param {number|string} threadId
 * @param {number|string} [messageId]
 * @returns {string|null}
 */
export function forumTopicUrl(chatId, threadId, messageId) {
  const c = telegramInternalChatId(chatId);
  if (!c || threadId == null || threadId === "") return null;
  const thread = String(threadId);
  if (messageId != null && messageId !== "" && String(messageId) !== thread) {
    return `https://t.me/c/${c}/${thread}/${messageId}`;
  }
  return `https://t.me/c/${c}/${thread}`;
}

/**
 * Web UI deep link for an agent session.
 * @param {{ origin?: string, project: string, agentId: string }} opts
 * @returns {string|null}
 */
export function uiSessionUrl({ origin, project, agentId } = {}) {
  if (!project || !agentId) return null;
  const base = (origin || bridgeUiOrigin()).replace(/\/$/, "");
  const params = new URLSearchParams({
    project: String(project),
    agent: String(agentId),
  });
  return `${base}/?${params.toString()}`;
}

/**
 * Resolve forum thread id for an agent / session record.
 * @param {{ telegramThreadId?: number|null, agentId?: string }|null|undefined} session
 * @returns {number|null}
 */
export function resolveTelegramTopicForAgent(session) {
  if (!session) return null;
  if (session.telegramThreadId != null && Number.isFinite(Number(session.telegramThreadId))) {
    return Number(session.telegramThreadId);
  }
  const binding = getBindingByAgentId(session.agentId);
  if (binding?.threadId != null) return Number(binding.threadId);
  return null;
}

/**
 * Build telegramTopicUrl for a public session payload.
 * @param {{ telegramThreadId?: number|null, agentId?: string }|null|undefined} session
 * @returns {string|null}
 */
export function telegramTopicUrlForSession(session) {
  const chatId = getTelegramChatId();
  const threadId = resolveTelegramTopicForAgent(session);
  if (!chatId || threadId == null) return null;
  return forumTopicUrl(chatId, threadId);
}
