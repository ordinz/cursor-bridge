import { execFileSync } from "node:child_process";
import {
  ROOT,
  UI_URL,
  WATCHDOG_PID,
  alive,
  clearPid,
  fetchHealth,
  probe,
  readPid,
  startStackDetached,
  writePid,
} from "./process-utils.mjs";

const INTERVAL_MS = 3 * 60_000;
const STARTUP_GRACE_MS = 12_000;
const UI_GRACE_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;
const startedAt = Date.now();

function log(msg) {
  // stdout is already redirected to the watchdog log by start-bg.
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
}

function stopStackKeepWatchdog() {
  execFileSync(process.execPath, ["scripts/stop.mjs", "--keep-watchdog"], {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    env: process.env,
  });
}

async function stackHealthy() {
  const health = await fetchHealth();
  if (!health?.ok) return { ok: false, reason: "api_down", health: null };

  let uiOk = await probe(UI_URL);
  if (!uiOk) {
    await new Promise((r) => setTimeout(r, UI_GRACE_MS));
    uiOk = await probe(UI_URL);
  }
  if (!uiOk) return { ok: false, reason: "ui_down", health };

  return { ok: true, reason: "ok", health };
}

async function heal(reason, backoffMs) {
  log(`unhealthy (${reason}) — restarting stack (backoff ${backoffMs}ms)`);
  try {
    stopStackKeepWatchdog();
  } catch (err) {
    log(`stop failed: ${err instanceof Error ? err.message : err}`);
  }
  await new Promise((r) => setTimeout(r, 1000));
  const pid = startStackDetached();
  log(`started stack pid ${pid}`);
  await new Promise((r) => setTimeout(r, Math.max(backoffMs, 4000)));
}

const existing = readPid(WATCHDOG_PID);
if (existing && existing !== process.pid && alive(existing)) {
  log(`already running as pid ${existing}; exiting`);
  process.exit(0);
}
writePid(WATCHDOG_PID, process.pid);

const shutdown = () => {
  if (readPid(WATCHDOG_PID) === process.pid) clearPid(WATCHDOG_PID);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

log(`watchdog started pid ${process.pid}`);

let backoffMs = 5_000;
let healing = false;

async function tick() {
  if (healing) return;

  // Avoid fighting a stack that start-bg just launched.
  if (Date.now() - startedAt < STARTUP_GRACE_MS) {
    const status = await stackHealthy();
    if (status.ok) {
      log("stack healthy");
      backoffMs = 5_000;
    } else {
      log(`startup grace — ${status.reason}, waiting`);
    }
    return;
  }

  const status = await stackHealthy();
  if (status.ok) {
    if (backoffMs !== 5_000) log("stack healthy — reset backoff");
    backoffMs = 5_000;
    return;
  }

  healing = true;
  try {
    await heal(status.reason, backoffMs);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  } catch (err) {
    log(`heal error: ${err instanceof Error ? err.message : err}`);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  } finally {
    healing = false;
  }
}

await tick();
setInterval(() => {
  writePid(WATCHDOG_PID, process.pid);
  void tick();
}, INTERVAL_MS);
