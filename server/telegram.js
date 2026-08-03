const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;
const TELEGRAM_RICH_MESSAGE_MAX_LENGTH = 32768;
const TELEGRAM_API = "https://api.telegram.org";

export class TelegramNotConfiguredError extends Error {
  constructor() {
    super("Telegram is not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)");
    this.name = "TelegramNotConfiguredError";
    this.status = 503;
    this.code = "TELEGRAM_NOT_CONFIGURED";
  }
}

export class TelegramSendError extends Error {
  constructor(message) {
    super(message);
    this.name = "TelegramSendError";
    this.status = 502;
    this.code = "TELEGRAM_SEND_FAILED";
  }
}

export function isTelegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export function isTelegramWebhookConfigured() {
  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN &&
      process.env.TELEGRAM_CHAT_ID &&
      process.env.TELEGRAM_WEBHOOK_SECRET,
  );
}

export function getTelegramChatId() {
  return process.env.TELEGRAM_CHAT_ID?.trim() || null;
}

export function getTelegramBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

export function getTelegramWebhookSecret() {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
}

/** Env key for a topic label: status → TELEGRAM_TOPIC_STATUS, cursor-bridge → TELEGRAM_TOPIC_CURSOR_BRIDGE */
export function telegramTopicEnvKey(label) {
  return `TELEGRAM_TOPIC_${String(label).toUpperCase().replace(/-/g, "_")}`;
}

/**
 * Map of topic label → message_thread_id from TELEGRAM_TOPIC_* env vars.
 * Always includes status/app/www keys (null when unset) plus any other TELEGRAM_TOPIC_* present.
 * @returns {Record<string, number|null>}
 */
export function getTelegramTopicMap() {
  const parse = (value) => {
    if (!value?.trim()) return null;
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  };

  /** @type {Record<string, number|null>} */
  const map = {
    status: parse(process.env.TELEGRAM_TOPIC_STATUS),
    app: parse(process.env.TELEGRAM_TOPIC_APP),
    www: parse(process.env.TELEGRAM_TOPIC_WWW),
  };

  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^TELEGRAM_TOPIC_(.+)$/);
    if (!match) continue;
    const label = match[1].toLowerCase().replace(/_/g, "-");
    if (label in map && map[label] != null) continue;
    map[label] = parse(value);
  }

  return map;
}

/** Project topic labels that have a configured thread id (excludes status). */
export function getConfiguredProjectTopics() {
  const map = getTelegramTopicMap();
  return Object.entries(map)
    .filter(([label, id]) => label !== "status" && id != null)
    .map(([label]) => label);
}

/** @returns {Set<number>} empty = allow any member of the configured chat */
export function getTelegramAllowedUserIds() {
  const raw = process.env.TELEGRAM_ALLOWED_USER_IDS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n)),
  );
}

export function resolveWebhookPublicUrl() {
  if (process.env.TELEGRAM_WEBHOOK_PUBLIC_URL?.trim()) {
    return process.env.TELEGRAM_WEBHOOK_PUBLIC_URL.trim().replace(/\/$/, "");
  }
  const host =
    process.env.TELEGRAM_TUNNEL_HOST?.trim() ||
    process.env.TUNNEL_HOST?.trim() ||
    "cursor-bridge.kairose.com";
  const hostname = host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${hostname}/cursor-bridge/telegram/webhook`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} method
 * @param {Record<string, unknown>} [body]
 * @param {{ retries?: number }} [opts]
 */
export async function telegramApi(method, body, opts = {}) {
  const retries = opts.retries ?? 2;
  const token = getTelegramBotToken();
  if (!token) {
    throw new TelegramNotConfiguredError();
  }

  const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const detail =
      typeof data.description === "string"
        ? data.description
        : `HTTP ${res.status}`;
    const retryAfter = detail.match(/retry after (\d+)/i);
    if (retries > 0 && (res.status === 429 || retryAfter)) {
      const waitSec = retryAfter ? Number(retryAfter[1]) : 3;
      await sleep(Math.min(Math.max(waitSec, 1), 60) * 1000);
      return telegramApi(method, body, { retries: retries - 1 });
    }
    throw new TelegramSendError(`Telegram API error: ${detail}`);
  }
  return data.result;
}

/**
 * Resolve a Telegram file_id to a downloadable path (valid ~1 hour).
 * @param {string} fileId
 * @returns {Promise<{ file_id: string, file_unique_id?: string, file_size?: number, file_path?: string }>}
 */
export async function getTelegramFile(fileId) {
  if (!fileId || typeof fileId !== "string") {
    throw new TelegramSendError("file_id is required");
  }
  return telegramApi("getFile", { file_id: fileId });
}

/**
 * Download a Telegram file by file_id into a Buffer.
 * @param {string} fileId
 * @returns {Promise<{ buffer: Buffer, filePath: string, fileSize: number|null }>}
 */
export async function downloadTelegramFile(fileId) {
  const token = getTelegramBotToken();
  if (!token) throw new TelegramNotConfiguredError();

  const meta = await getTelegramFile(fileId);
  const filePath = typeof meta?.file_path === "string" ? meta.file_path : "";
  if (!filePath) {
    throw new TelegramSendError("Telegram file_path missing (file too large or unavailable)");
  }

  const res = await fetch(`${TELEGRAM_API}/file/bot${token}/${filePath}`);
  if (!res.ok) {
    throw new TelegramSendError(`Telegram file download failed: HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return {
    buffer: Buffer.from(ab),
    filePath,
    fileSize:
      typeof meta.file_size === "number" ? meta.file_size : ab.byteLength,
  };
}

function chunkText(text, max) {
  if (text.length <= max) return [text];
  const chunks = [];
  for (let i = 0; i < text.length; i += max) {
    chunks.push(text.slice(i, i + max));
  }
  return chunks;
}

function requireChat(opts) {
  const chatId = opts.chatId ?? getTelegramChatId();
  if (!getTelegramBotToken() || !chatId) {
    throw new TelegramNotConfiguredError();
  }
  return chatId;
}

function threadFields(opts) {
  /** @type {Record<string, unknown>} */
  const extra = {};
  if (opts.messageThreadId != null) {
    extra.message_thread_id = opts.messageThreadId;
  }
  if (opts.replyToMessageId != null) {
    extra.reply_to_message_id = opts.replyToMessageId;
  }
  return extra;
}

/**
 * Send a permanent Telegram message (plain text).
 * Back-compat: `sendTelegramMessage("hello")` or options object.
 *
 * @param {string | {
 *   text: string,
 *   messageThreadId?: number|null,
 *   chatId?: string|number,
 *   replyToMessageId?: number,
 *   parseMode?: string,
 *   replyMarkup?: object|null,
 * }} messageOrOpts
 */
export async function sendTelegramMessage(messageOrOpts) {
  const opts =
    typeof messageOrOpts === "string"
      ? { text: messageOrOpts }
      : messageOrOpts ?? {};

  const text = typeof opts.text === "string" ? opts.text : "";
  if (!text.trim()) {
    throw new TelegramSendError("message must not be empty");
  }

  const chatId = requireChat(opts);
  const chunks = chunkText(text, TELEGRAM_MESSAGE_MAX_LENGTH);
  let lastMessageId = null;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isLast = i === chunks.length - 1;
    /** @type {Record<string, unknown>} */
    const body = {
      chat_id: chatId,
      text: chunk,
      ...threadFields(opts),
    };
    if (opts.parseMode) {
      body.parse_mode = opts.parseMode;
    }
    // Attach keyboard only on the final chunk so buttons aren't orphaned mid-split.
    if (isLast && opts.replyMarkup) {
      body.reply_markup = opts.replyMarkup;
    }
    const result = await telegramApi("sendMessage", body);
    lastMessageId = result?.message_id ?? null;
  }

  return { ok: true, messageId: lastMessageId, rich: false };
}

/**
 * Send a rich message (Bot API 10.1+). Prefers markdown; falls back to plain sendMessage.
 *
 * @param {{
 *   markdown?: string,
 *   html?: string,
 *   text?: string,
 *   messageThreadId?: number|null,
 *   chatId?: string|number,
 *   replyToMessageId?: number,
 *   plainFallback?: string,
 *   replyMarkup?: object|null,
 * }} opts
 */
export async function sendTelegramRichMessage(opts = {}) {
  const markdown = opts.markdown ?? opts.text;
  const html = opts.html;
  const plain =
    opts.plainFallback ??
    (typeof markdown === "string" ? markdown : null) ??
    (typeof html === "string" ? html.replace(/<[^>]+>/g, "") : null) ??
    "";

  if (!markdown?.trim() && !html?.trim()) {
    throw new TelegramSendError("markdown or html required");
  }

  const chatId = requireChat(opts);
  const rich_message = html?.trim()
    ? {
        html: html.slice(0, TELEGRAM_RICH_MESSAGE_MAX_LENGTH),
        skip_entity_detection: false,
      }
    : {
        markdown: String(markdown).slice(0, TELEGRAM_RICH_MESSAGE_MAX_LENGTH),
        skip_entity_detection: false,
      };

  try {
    /** @type {Record<string, unknown>} */
    const body = {
      chat_id: chatId,
      rich_message,
      ...threadFields(opts),
    };
    if (opts.replyMarkup) {
      body.reply_markup = opts.replyMarkup;
    }
    const result = await telegramApi("sendRichMessage", body);
    return { ok: true, messageId: result?.message_id ?? null, rich: true };
  } catch (err) {
    console.warn(
      "[telegram] sendRichMessage failed, falling back to plain:",
      err instanceof Error ? err.message : err,
    );
    return sendTelegramMessage({
      text: plain.slice(0, TELEGRAM_MESSAGE_MAX_LENGTH) || "(empty)",
      messageThreadId: opts.messageThreadId,
      chatId: opts.chatId,
      replyToMessageId: opts.replyToMessageId,
      replyMarkup: opts.replyMarkup,
    });
  }
}

/**
 * @param {{ draftId: number, text: string, messageThreadId?: number|null, chatId?: string|number }} opts
 */
export async function sendTelegramMessageDraft(opts) {
  const chatId = requireChat(opts);
  if (!opts.draftId || !Number.isFinite(opts.draftId)) {
    throw new TelegramSendError("draftId must be a non-zero number");
  }
  const text = opts.text?.slice(0, TELEGRAM_MESSAGE_MAX_LENGTH) || "…";
  await telegramApi("sendMessageDraft", {
    chat_id: chatId,
    draft_id: opts.draftId,
    text,
    ...threadFields(opts),
  });
  return { ok: true, rich: false };
}

/**
 * Stream a partial rich message (Bot API 10.1+).
 * Uses HTML when provided. Does NOT fall back to plain sendMessageDraft
 * (that materializes ugly permanent messages in forum groups).
 *
 * @param {{ draftId: number, html?: string, markdown?: string, text?: string, messageThreadId?: number|null, chatId?: string|number }} opts
 */
export async function sendTelegramRichMessageDraft(opts) {
  const chatId = requireChat(opts);
  if (!opts.draftId || !Number.isFinite(opts.draftId)) {
    throw new TelegramSendError("draftId must be a non-zero number");
  }

  const html = opts.html?.trim();
  const markdown = (opts.markdown ?? opts.text ?? "").trim();
  if (!html && !markdown) {
    throw new TelegramSendError("html or markdown required");
  }

  const rich_message = html
    ? {
        html: html.slice(0, TELEGRAM_RICH_MESSAGE_MAX_LENGTH),
        skip_entity_detection: false,
      }
    : {
        markdown: markdown.slice(0, TELEGRAM_RICH_MESSAGE_MAX_LENGTH),
        skip_entity_detection: false,
      };

  await telegramApi("sendRichMessageDraft", {
    chat_id: chatId,
    draft_id: opts.draftId,
    rich_message,
    ...threadFields(opts),
  });
  return { ok: true, rich: true };
}

/**
 * @param {{
 *   messageId: number,
 *   text: string,
 *   messageThreadId?: number|null,
 *   chatId?: string|number,
 *   replyMarkup?: object|null,
 *   parseMode?: string,
 * }} opts
 */
export async function editTelegramMessageText(opts) {
  const chatId = requireChat(opts);
  /** @type {Record<string, unknown>} */
  const body = {
    chat_id: chatId,
    message_id: opts.messageId,
    text: opts.text.slice(0, TELEGRAM_MESSAGE_MAX_LENGTH),
    ...threadFields(opts),
  };
  if (opts.parseMode) body.parse_mode = opts.parseMode;
  if (opts.replyMarkup !== undefined) {
    body.reply_markup = opts.replyMarkup ?? { inline_keyboard: [] };
  }
  await telegramApi("editMessageText", body);
  return { ok: true };
}

/**
 * @param {{
 *   messageId: number,
 *   replyMarkup?: object|null,
 *   chatId?: string|number,
 * }} opts
 */
export async function editTelegramReplyMarkup(opts) {
  const chatId = requireChat(opts);
  await telegramApi("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: opts.messageId,
    reply_markup: opts.replyMarkup ?? { inline_keyboard: [] },
  });
  return { ok: true };
}

/**
 * @param {{
 *   callbackQueryId: string,
 *   text?: string,
 *   showAlert?: boolean,
 * }} opts
 */
export async function answerTelegramCallbackQuery(opts) {
  if (!opts.callbackQueryId) {
    throw new TelegramSendError("callbackQueryId required");
  }
  /** @type {Record<string, unknown>} */
  const body = { callback_query_id: opts.callbackQueryId };
  if (opts.text) body.text = opts.text.slice(0, 200);
  if (opts.showAlert) body.show_alert = true;
  await telegramApi("answerCallbackQuery", body);
  return { ok: true };
}

/**
 * Register the public webhook URL with Telegram.
 * @param {{ url?: string, secret?: string }} [opts]
 */
export async function setTelegramWebhook(opts = {}) {
  const url = opts.url ?? resolveWebhookPublicUrl();
  const secret = opts.secret ?? getTelegramWebhookSecret();
  if (!getTelegramBotToken()) {
    throw new TelegramNotConfiguredError();
  }
  if (!secret) {
    throw new TelegramSendError(
      "TELEGRAM_WEBHOOK_SECRET is required to set webhook",
    );
  }
  await telegramApi("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  return { ok: true, url };
}

/**
 * Slash-menu commands (Telegram forbids spaces in command names).
 * Keep in sync with handleCommand in telegram-operator.js.
 */
export const TELEGRAM_BOT_COMMANDS = [
  {
    command: "phone_on",
    description: "Mirror Cursor Agents → Telegram + enable prompts",
  },
  { command: "phone_off", description: "Stop IDE mirror + phone prompts" },
  { command: "status", description: "Health, sessions, IDE mirror" },
  { command: "settings", description: "Model, mode, toggles (inline buttons)" },
  { command: "stop", description: "Cancel active Cursor run(s)" },
  { command: "new", description: "New session in this project topic" },
  { command: "help", description: "List commands" },
];

/**
 * Register the / menu commands shown when typing "/" in Telegram.
 */
export async function setTelegramBotCommands() {
  if (!getTelegramBotToken()) {
    throw new TelegramNotConfiguredError();
  }

  const commands = TELEGRAM_BOT_COMMANDS;
  const chatId = getTelegramChatId();

  await telegramApi("setMyCommands", { commands });
  await telegramApi("setMyCommands", {
    commands,
    scope: { type: "all_group_chats" },
  });
  await telegramApi("setMyCommands", {
    commands,
    scope: { type: "all_private_chats" },
  });

  // Pin commands on the Cursor Bridge forum itself (most reliable for / preview).
  if (chatId) {
    await telegramApi("setMyCommands", {
      commands,
      scope: { type: "chat", chat_id: chatId },
    });
  }

  return { ok: true, commands };
}

/**
 * @returns {Promise<object[]>}
 */
export async function getTelegramBotCommands(scope) {
  const body = scope ? { scope } : {};
  const result = await telegramApi("getMyCommands", body);
  return Array.isArray(result) ? result : [];
}

export { TELEGRAM_MESSAGE_MAX_LENGTH, TELEGRAM_RICH_MESSAGE_MAX_LENGTH };
