import { kvGet, kvSet } from "./db.js";

const KV_KEY = "telegram-prefs";

/** @typedef {"agent" | "plan"} TelegramAgentMode */

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
  const parsed = kvGet(KV_KEY, null);
  if (!parsed || typeof parsed !== "object") return defaultState();
  return {
    model:
      typeof parsed.model === "string" && parsed.model.trim()
        ? parsed.model.trim()
        : "default",
    mode: normalizeMode(parsed.mode),
    includeDevLogs: Boolean(parsed.includeDevLogs),
  };
}

function writeState(next) {
  kvSet(KV_KEY, next);
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
  if (!state) {
    kvSet(KV_KEY, defaultState());
    return;
  }
  kvSet(KV_KEY, { ...defaultState(), ...state });
}
