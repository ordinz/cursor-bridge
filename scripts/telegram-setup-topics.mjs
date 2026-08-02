#!/usr/bin/env node
/**
 * Print recent Telegram updates so you can copy chat id + topic thread ids
 * after posting a message in Status / app / www topics of the Cursor Bridge group.
 *
 * Usage: pnpm telegram:setup-topics
 */
import "dotenv/config";
import { getTelegramBotToken, telegramApi } from "../server/telegram.js";

const token = getTelegramBotToken();
if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}

const updates = await telegramApi("getUpdates", { limit: 50, timeout: 0 });
if (!Array.isArray(updates) || updates.length === 0) {
  console.log(
    "No updates. Send a message in each forum topic (Status, app, www), then re-run.",
  );
  console.log(
    "(If a webhook is already set, delete it first: open Bot API deleteWebhook, or temporarily unset and restart.)",
  );
  process.exit(0);
}

const seen = new Map();

for (const update of updates) {
  const message = update.message;
  if (!message?.chat) continue;
  const chatId = message.chat.id;
  const threadId = message.message_thread_id ?? null;
  const topicName =
    message.reply_to_message?.forum_topic_created?.name ||
    message.forum_topic_created?.name ||
    null;
  const key = `${chatId}:${threadId ?? "root"}`;
  if (seen.has(key)) continue;
  seen.set(key, {
    chatId,
    chatTitle: message.chat.title || message.chat.username || "(private)",
    threadId,
    topicName,
    sampleText: (message.text || "").slice(0, 60),
  });
}

console.log("Recent chats / topics from getUpdates:\n");
for (const row of seen.values()) {
  console.log(`  chat:  ${row.chatTitle}`);
  console.log(`  TELEGRAM_CHAT_ID=${row.chatId}`);
  if (row.threadId != null) {
    console.log(
      `  thread_id=${row.threadId}${row.topicName ? ` (${row.topicName})` : ""}`,
    );
    const hint = (row.topicName || row.sampleText || "").toLowerCase();
    if (hint.includes("status")) {
      console.log(`  → TELEGRAM_TOPIC_STATUS=${row.threadId}`);
    } else if (hint === "app" || hint.startsWith("app ")) {
      console.log(`  → TELEGRAM_TOPIC_APP=${row.threadId}`);
    } else if (hint === "www" || hint.startsWith("www ")) {
      console.log(`  → TELEGRAM_TOPIC_WWW=${row.threadId}`);
    }
  } else {
    console.log("  thread_id=(none — General / non-forum)");
  }
  if (row.sampleText) console.log(`  sample: ${row.sampleText}`);
  console.log("");
}

console.log(
  "Paste the matching TELEGRAM_CHAT_ID and TELEGRAM_TOPIC_* values into .env",
);
