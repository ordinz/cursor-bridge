import fs from "fs";
import os from "os";
import path from "path";

const STATE_DIR = path.join(os.homedir(), ".cursor-bridge");
const STATE_FILE = path.join(STATE_DIR, "telegram-prefs.json");

/** @typedef {"agent" | "plan"} TelegramAgentMode */

/** @type {{ model: string, mode: TelegramAgentMode, includeDevLogs: boolean } | null} */
let cached = null;

function defaultState() {
  return {
    model: "default",
    mode: /** @type {TelegramAgentMode} */ ("agent"),
    includeDevLogs: false,
  };
}

function normalizeMode(value) {
  return value === "plan" ? "plan" : "agent";
}

function readState() {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    cached = {
      model:
        typeof parsed?.model === "string" && parsed.model.trim()
          ? parsed.model.trim()
          : "default",
      mode: normalizeMode(parsed?.mode),
      includeDevLogs: Boolean(parsed?.includeDevLogs),
    };
  } catch {
    cached = defaultState();
  }
  return cached;
}

function writeState(next) {
  cached = next;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch (err) {
    console.warn(
      "[telegram] failed to persist prefs:",
      err instanceof Error ? err.message : err,
    );
  }
}

export function getTelegramPrefs() {
  return { ...readState() };
}

/**
 * @param {Partial<{ model: string, mode: TelegramAgentMode, includeDevLogs: boolean }>} patch
 */
export function updateTelegramPrefs(patch = {}) {
  const cur = readState();
  const next = {
    model:
      typeof patch.model === "string" && patch.model.trim()
        ? patch.model.trim()
        : cur.model,
    mode:
      patch.mode !== undefined ? normalizeMode(patch.mode) : cur.mode,
    includeDevLogs:
      patch.includeDevLogs !== undefined
        ? Boolean(patch.includeDevLogs)
        : cur.includeDevLogs,
  };
  writeState(next);
  return { ...next };
}

/** Test helper */
export function _resetTelegramPrefsForTests(state = null) {
  cached = state ? { ...defaultState(), ...state } : null;
}
