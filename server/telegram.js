const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;

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

export async function sendTelegramMessage(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new TelegramNotConfiguredError();
  }

  if (message.length > TELEGRAM_MESSAGE_MAX_LENGTH) {
    throw new TelegramSendError(
      `message exceeds Telegram maximum length of ${TELEGRAM_MESSAGE_MAX_LENGTH} characters`,
    );
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok || body.ok === false) {
    const detail =
      typeof body.description === "string"
        ? body.description
        : `HTTP ${res.status}`;
    throw new TelegramSendError(`Telegram API error: ${detail}`);
  }

  return {
    ok: true,
    messageId: body.result?.message_id ?? null,
  };
}
