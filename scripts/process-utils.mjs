import { spawn, execFileSync } from "node:child_process";
import {
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const HEALTH_URL = "http://127.0.0.1:4242/api/health";
export const UI_URL = "http://127.0.0.1:5173/";
export const LOG = "/tmp/cursor-bridge.log";
export const WATCHDOG_LOG = "/tmp/cursor-bridge-watchdog.log";
export const WATCHDOG_PID = "/tmp/cursor-bridge-watchdog.pid";
export const PORTS = [4242, 4243, 5173];

const SANDBOX_KEYS = [
  "CURSOR_SANDBOX",
  "CURSOR_AGENT",
  "CURSOR_ORIG_UID",
  "CURSOR_ORIG_GID",
  "CURSOR_RIPGREP_PATH",
  "CURSOR_WORKSPACE_LABEL",
  "CURSOR_LAYOUT",
  "CURSOR_CONVERSATION_ID",
];

/** Strip Cursor agent sandbox vars so children can reach the Cursor API. */
export function cleanEnv(base = process.env) {
  const env = { ...base };
  for (const key of SANDBOX_KEYS) delete env[key];
  return env;
}

export async function probe(url, ms = 2000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchHealth(ms = 2000) {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function alive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

export function readPid(file) {
  try {
    const pid = Number(readFileSync(file, "utf8").trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function writePid(file, pid) {
  writeFileSync(file, `${pid}\n`, "utf8");
}

export function clearPid(file) {
  try {
    unlinkSync(file);
  } catch {
    // ignore
  }
}

export function killPid(pid, signal = "SIGTERM") {
  try {
    process.kill(Number(pid), signal);
    return true;
  } catch {
    return false;
  }
}

export function pidsOnPort(port) {
  try {
    return execFileSync("lsof", [`-tiTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function startStackDetached() {
  const logFd = openSync(LOG, "a");
  const child = spawn("pnpm", ["start"], {
    cwd: ROOT,
    env: cleanEnv(),
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  return child.pid;
}

export function startWatchdogDetached() {
  const existing = readPid(WATCHDOG_PID);
  if (existing && alive(existing)) return existing;

  const logFd = openSync(WATCHDOG_LOG, "a");
  const child = spawn(process.execPath, [join(ROOT, "scripts/watchdog.mjs")], {
    cwd: ROOT,
    env: cleanEnv(),
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  writePid(WATCHDOG_PID, child.pid);
  return child.pid;
}

export async function stopWatchdog({ waitMs = 800 } = {}) {
  const pid = readPid(WATCHDOG_PID);
  clearPid(WATCHDOG_PID);
  if (!pid) return;
  killPid(pid, "SIGTERM");
  await new Promise((r) => setTimeout(r, waitMs));
  if (alive(pid)) killPid(pid, "SIGKILL");
}

export function isWatchdogRunning() {
  const pid = readPid(WATCHDOG_PID);
  return Boolean(pid && alive(pid));
}
