import { kvGet, kvSet } from "./db.js";

const KV_KEY = "telegram-phone";

function defaultState() {
  return { phoneMode: false };
}

function readState() {
  const parsed = kvGet(KV_KEY, null);
  if (!parsed || typeof parsed !== "object") return defaultState();
  return { phoneMode: Boolean(parsed.phoneMode) };
}

function writeState(next) {
  kvSet(KV_KEY, next);
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
