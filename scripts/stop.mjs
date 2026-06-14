import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORTS = [4242, 4243, 5173];

function pidsOnPort(port) {
  try {
    return execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function killPids(pids, label) {
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
      console.log(`cursor-bridge: stopped pid ${pid} (${label})`);
    } catch {
      // process may have already exited
    }
  }
}

for (const port of PORTS) {
  killPids(pidsOnPort(port), `port ${port}`);
}

try {
  const supervisors = execSync(`pgrep -f "${join(ROOT, "scripts/run.mjs")}"`, {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  killPids(supervisors, "supervisor");
} catch {
  // no supervisor running
}
