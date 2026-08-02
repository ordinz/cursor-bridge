#!/usr/bin/env node
/**
 * Register Telegram webhook for the Cursor Bridge phone console.
 * Usage: pnpm telegram:set-webhook
 */
import "dotenv/config";
import {
  isTelegramWebhookConfigured,
  resolveWebhookPublicUrl,
  setTelegramWebhook,
} from "../server/telegram.js";

if (!isTelegramWebhookConfigured()) {
  console.error(
    "Set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, and TELEGRAM_WEBHOOK_SECRET in .env",
  );
  process.exit(1);
}

const url = resolveWebhookPublicUrl();
const result = await setTelegramWebhook({ url });
console.log(`Webhook set → ${result.url}`);
