import fs from "fs";
import os from "os";
import path from "path";

const STATE_DIR = path.join(os.homedir(), ".cursor-bridge");
const STATE_FILE = path.join(STATE_DIR, "telegram-phone.json");

/** @type {{ phoneMode: boolean } | null} */
let cached = null;

function defaultState() {
  return { phoneMode: false };
}

function readState() {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    cached = {
      phoneMode: Boolean(parsed?.phoneMode),
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
      "[telegram] failed to persist phone mode:",
      err instanceof Error ? err.message : err,
    );
  }
}

export function isPhoneModeOn() {
  return readState().phoneMode === true;
}

export function getPhoneModeState() {
  return { ...readState() };
}

export function setPhoneMode(on) {
  const next = { phoneMode: Boolean(on) };
  writeState(next);
  return next;
}
