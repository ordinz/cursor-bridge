import { modelLabel } from "./telegram-models.js";

/**
 * Telegram has no native checkboxes — fake them with ○/● and ☐/☑ on
 * callback buttons, then editMessageReplyMarkup on each tap.
 *
 * callback_data max 64 bytes. Keep payloads short (`c:` prefix).
 */

/** @param {string} text @param {string} data */
function btn(text, data) {
  return { text, callback_data: data.slice(0, 64) };
}

/** @param {Array<Array<{ text: string, callback_data: string }>>} rows */
export function inlineKeyboard(rows) {
  return { inline_keyboard: rows };
}

/**
 * @param {{ phoneOn: boolean }} opts
 */
export function mainControlKeyboard({ phoneOn }) {
  return inlineKeyboard([
    [
      btn(phoneOn ? "☑ Phone ON" : "☐ Phone OFF", "c:phone"),
      btn("⏹ Stop", "c:stop"),
    ],
    [
      btn("⚙ Settings", "c:set"),
      btn("＋ New", "c:new"),
      btn("❓ Help", "c:help"),
    ],
    [btn("↻ Status", "c:status")],
  ]);
}

/**
 * @param {{
 *   mode: "agent" | "plan",
 *   model: string,
 *   includeDevLogs: boolean,
 * }} opts
 */
export function settingsKeyboard({ mode, model, includeDevLogs }) {
  const modelName = modelLabel(model);
  return inlineKeyboard([
    [
      btn(mode === "agent" ? "● agent" : "○ agent", "c:mode:agent"),
      btn(mode === "plan" ? "● plan" : "○ plan", "c:mode:plan"),
    ],
    [btn(`Model: ${truncate(modelName, 28)} ▾`, "c:mdl")],
    [
      btn(
        includeDevLogs ? "☑ Dev logs" : "☐ Dev logs",
        "c:logs",
      ),
    ],
    [
      btn("← Controls", "c:menu"),
      btn("↻ Status", "c:status"),
    ],
  ]);
}

/**
 * @param {{ id: string, displayName: string }[]} models
 * @param {string} selectedId
 */
export function modelPickerKeyboard(models, selectedId) {
  const rows = [];
  const list = models.slice(0, 12);
  for (let i = 0; i < list.length; i += 2) {
    const chunk = list.slice(i, i + 2).map((m, offset) => {
      const idx = i + offset;
      const mark = m.id === selectedId ? "● " : "○ ";
      return btn(`${mark}${truncate(m.displayName || m.id, 18)}`, `c:mdl:${idx}`);
    });
    rows.push(chunk);
  }
  rows.push([btn("← Settings", "c:set")]);
  return inlineKeyboard(rows);
}

/**
 * Compact actions under a finished run.
 * @param {{ busy?: boolean }} [opts]
 */
export function postRunKeyboard({ busy = false } = {}) {
  return inlineKeyboard([
    [
      btn(busy ? "⏹ Stop" : "＋ New", busy ? "c:stop" : "c:new"),
      btn("⚙ Settings", "c:set"),
      btn("↻ Status", "c:status"),
    ],
  ]);
}

/**
 * @param {string | undefined} data
 * @returns {{ op: string, arg?: string } | null}
 */
export function parseCallbackData(data) {
  if (typeof data !== "string" || !data.startsWith("c:")) return null;
  const rest = data.slice(2);
  if (!rest) return null;

  if (rest === "phone" || rest === "stop" || rest === "new" || rest === "status") {
    return { op: rest };
  }
  if (rest === "help" || rest === "menu" || rest === "set" || rest === "mdl" || rest === "logs") {
    return { op: rest };
  }
  if (rest.startsWith("mode:")) {
    const mode = rest.slice(5);
    if (mode === "agent" || mode === "plan") return { op: "mode", arg: mode };
    return null;
  }
  if (rest.startsWith("mdl:")) {
    const idx = rest.slice(4);
    if (/^\d{1,3}$/.test(idx)) return { op: "mdl", arg: idx };
    return null;
  }
  return null;
}

function truncate(text, max) {
  const s = String(text || "");
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(1, max - 1))}…`;
}
