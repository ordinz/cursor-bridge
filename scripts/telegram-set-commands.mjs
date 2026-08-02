#!/usr/bin/env node
/**
 * Register Telegram slash-menu commands for the Cursor Bridge bot.
 * Usage: pnpm telegram:set-commands
 */
import "dotenv/config";
import {
  getTelegramBotCommands,
  getTelegramChatId,
  setTelegramBotCommands,
} from "../server/telegram.js";

const result = await setTelegramBotCommands();
console.log(
  "Registered:",
  result.commands.map((c) => `/${c.command}`).join(" "),
);

const defaultCmds = await getTelegramBotCommands();
console.log(
  "getMyCommands (default):",
  defaultCmds.map((c) => `/${c.command}`).join(" ") || "(none)",
);

const chatId = getTelegramChatId();
if (chatId) {
  const chatCmds = await getTelegramBotCommands({
    type: "chat",
    chat_id: chatId,
  });
  console.log(
    `getMyCommands (chat ${chatId}):`,
    chatCmds.map((c) => `/${c.command}`).join(" ") || "(none)",
  );
}
