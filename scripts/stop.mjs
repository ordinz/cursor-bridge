import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PORTS,
  ROOT,
  alive,
  killPid,
  pidsOnPort,
  stopWatchdog,
} from "./process-utils.mjs";

const keepWatchdog = process.argv.includes("--keep-watchdog");

function killPids(pids, signal, label) {
  for (const pid of pids) {
    if (killPid(pid, signal)) {
      console.log(`cursor-bridge: sent ${signal} to pid ${pid} (${label})`);
    }
  }
}

async function stop() {
  if (!keepWatchdog) {
    await stopWatchdog();
  }

  const seen = new Set();

  for (const port of PORTS) {
    for (const pid of pidsOnPort(port)) {
      seen.add(pid);
      killPids([pid], "SIGTERM", `port ${port}`);
    }
  }

  try {
    const supervisors = execFileSync(
      "pgrep",
      ["-f", join(ROOT, "scripts/run.mjs")],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const pid of supervisors) {
      seen.add(pid);
      killPids([pid], "SIGTERM", "supervisor");
    }
  } catch {
    // no supervisor
  }

  await new Promise((r) => setTimeout(r, 800));

  for (const pid of seen) {
    if (alive(pid)) killPids([pid], "SIGKILL", "stubborn");
  }

  for (const port of PORTS) {
    const leftover = pidsOnPort(port);
    if (leftover.length) killPids(leftover, "SIGKILL", `port ${port}`);
  }
}

await stop();
