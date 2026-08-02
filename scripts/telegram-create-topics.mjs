#!/usr/bin/env node
/**
 * Create missing Cursor Bridge forum topics via Bot API and print .env lines.
 *
 * Creates Status (if missing) plus one topic per ENABLED_PROJECTS id that does
 * not already have TELEGRAM_TOPIC_<ID> set.
 *
 * Usage: pnpm telegram:create-topics
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  getTelegramBotToken,
  getTelegramChatId,
  getTelegramTopicMap,
  telegramApi,
  telegramTopicEnvKey,
} from "../server/telegram.js";
import { ENABLED_PROJECT_IDS } from "../server/projects.js";

const token = getTelegramBotToken();
const chatId = getTelegramChatId();
if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}
if (!chatId) {
  console.error("Set TELEGRAM_CHAT_ID in .env");
  process.exit(1);
}

const map = getTelegramTopicMap();
const wanted = ["status", ...ENABLED_PROJECT_IDS];
const created = [];
const skipped = [];
const envLines = [];

for (const label of wanted) {
  const envKey = telegramTopicEnvKey(label);
  if (map[label] != null) {
    skipped.push(`${label} (already ${map[label]})`);
    envLines.push(`${envKey}=${map[label]}`);
    continue;
  }

  const topicName = label === "status" ? "Status" : label;
  try {
    const topic = await telegramApi("createForumTopic", {
      chat_id: chatId,
      name: topicName,
    });
    const threadId = topic?.message_thread_id;
    if (threadId == null) {
      console.error(`createForumTopic(${topicName}) returned no thread id:`, topic);
      process.exit(1);
    }
    created.push(`${label}=${threadId}`);
    envLines.push(`${envKey}=${threadId}`);
    map[label] = threadId;

    // Seed a message so getUpdates / humans can find the topic easily
    await telegramApi("sendMessage", {
      chat_id: chatId,
      message_thread_id: threadId,
      text: `Topic ready for **${topicName}** project prompts.`,
      parse_mode: "Markdown",
    }).catch(() => {});
  } catch (err) {
    console.error(`Failed to create topic "${topicName}":`, err?.message || err);
    process.exit(1);
  }
}

console.log("Telegram forum topics\n");
if (created.length) {
  console.log("Created:");
  for (const line of created) console.log(`  + ${line}`);
  console.log("");
}
if (skipped.length) {
  console.log("Already configured:");
  for (const line of skipped) console.log(`  · ${line}`);
  console.log("");
}

console.log("Add / update these in .env:\n");
console.log(`TELEGRAM_CHAT_ID=${chatId}`);
for (const line of envLines) console.log(line);

const envPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.env",
);
if (fs.existsSync(envPath) && created.length) {
  let envText = fs.readFileSync(envPath, "utf8");
  for (const line of envLines) {
    const [key, value] = line.split("=");
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(envText)) {
      envText = envText.replace(re, `${key}=${value}`);
    } else {
      envText = envText.replace(/\s*$/, `\n${key}=${value}\n`);
    }
  }
  // Ensure ENABLED_PROJECTS includes new projects
  const enabled =
    process.env.ENABLED_PROJECTS?.trim() ||
    "www,app,admin,email,cursor-bridge";
  if (/^ENABLED_PROJECTS=/m.test(envText)) {
    envText = envText.replace(/^ENABLED_PROJECTS=.*$/m, `ENABLED_PROJECTS=${enabled}`);
  } else {
    envText = envText.replace(/\s*$/, `\nENABLED_PROJECTS=${enabled}\n`);
  }
  if (!/^PROJECT_PATH_OVERRIDES=/m.test(envText)) {
    const bridgePath = path.join(process.env.HOME || "", "dev/cursor-bridge");
    envText = envText.replace(
      /\s*$/,
      `\nPROJECT_PATH_OVERRIDES=cursor-bridge:${bridgePath}\n`,
    );
  }
  fs.writeFileSync(envPath, envText);
  console.log(`\nUpdated ${envPath}`);
}

console.log("\nRestart cursor-bridge so it picks up the new topic ids.");
