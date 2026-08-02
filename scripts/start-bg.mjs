import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  ROOT,
  UI_URL,
  fetchHealth,
  isWatchdogRunning,
  probe,
  startStackDetached,
  startWatchdogDetached,
} from "./process-utils.mjs";

async function waitForUi(ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await probe(UI_URL)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const health = await fetchHealth();
const apiUp = Boolean(health?.ok);
let uiUp = await probe(UI_URL);
const cursorReady = Boolean(health?.cursor?.ready);
const watchdogUp = isWatchdogRunning();

if (apiUp && uiUp) {
  const wdPid = startWatchdogDetached();
  if (!cursorReady) {
    console.log(
      `cursor-bridge: already running (cursor not ready: ${health?.cursor?.reason ?? "unknown"}; watchdog pid ${wdPid})`,
    );
  } else if (!watchdogUp) {
    console.log(`cursor-bridge: already running — started watchdog pid ${wdPid}`);
  } else {
    console.log(`cursor-bridge: already running (watchdog pid ${wdPid})`);
  }
  process.exit(0);
}

if (apiUp && !uiUp) {
  uiUp = await waitForUi(5000);
  if (uiUp) {
    const wdPid = startWatchdogDetached();
    console.log(`cursor-bridge: already running (watchdog pid ${wdPid})`);
    process.exit(0);
  }
  console.log("cursor-bridge: API up but UI down — restarting");
  try {
    execFileSync("bash", [join(ROOT, "scripts/stop.sh")], {
      cwd: ROOT,
      stdio: "inherit",
    });
  } catch {
    // best-effort
  }
  await new Promise((r) => setTimeout(r, 1000));
}

const stackPid = startStackDetached();
const wdPid = startWatchdogDetached();
console.log(
  `cursor-bridge: started stack pid ${stackPid}, watchdog pid ${wdPid} (log: /tmp/cursor-bridge.log)`,
);
