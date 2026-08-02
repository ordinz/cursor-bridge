#!/usr/bin/env node
/**
 * Print recent Telegram updates so you can copy chat id + topic thread ids
 * after posting in Cursor Bridge forum topics (or after createForumTopic).
 *
 * Usage: pnpm telegram:setup-topics
 */
import "dotenv/config";
import {
  getTelegramBotToken,
  telegramApi,
  telegramTopicEnvKey,
} from "../server/telegram.js";

const token = getTelegramBotToken();
if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}

const updates = await telegramApi("getUpdates", { limit: 50, timeout: 0 });
if (!Array.isArray(updates) || updates.length === 0) {
  console.log(
    "No updates. Prefer: pnpm telegram:create-topics (creates Status + project topics).",
  );
  console.log(
    "Or send a message in each topic, then re-run. If a webhook is set, deleteWebhook first.",
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
    const hint = (row.topicName || row.sampleText || "").trim();
    console.log(
      `  thread_id=${row.threadId}${row.topicName ? ` (${row.topicName})` : ""}`,
    );
    if (hint) {
      const label = hint.toLowerCase() === "status" ? "status" : hint.toLowerCase();
      console.log(`  → ${telegramTopicEnvKey(label)}=${row.threadId}`);
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
console.log("Or run: pnpm telegram:create-topics");
