import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const prod = process.argv.includes("--prod");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mcpEntry = join(root, "mcp/dist/index.js");

function run(command, args) {
  return spawn(command, args, {
    stdio: "inherit",
    env: process.env,
    cwd: root,
  });
}

function wait(proc) {
  return new Promise((resolve, reject) => {
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`exited with ${code}`));
    });
  });
}

async function ensureMcpBuilt() {
  if (existsSync(mcpEntry)) return;
  console.log("cursor-bridge: building MCP server…");
  await wait(run("pnpm", ["mcp:build"]));
}

function supervise(procs) {
  const shutdown = () => {
    for (const proc of procs) proc.kill("SIGTERM");
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  for (const proc of procs) {
    proc.on("exit", (code) => {
      shutdown();
      process.exit(code ?? 0);
    });
  }
}

await ensureMcpBuilt();

if (prod) {
  console.log("cursor-bridge: prod mode");
  console.log("  API  → http://127.0.0.1:4242/api/*");
  console.log("  UI   → http://127.0.0.1:4242");
  console.log("  MCP  → http://127.0.0.1:4243/mcp\n");
  await wait(run("pnpm", ["--filter", "ui", "build"]));
  supervise([run("node", ["bridge.mjs"]), run("pnpm", ["mcp:start"])]);
} else {
  console.log("cursor-bridge: dev mode");
  console.log("  API  → http://127.0.0.1:4242/api/*");
  console.log("  UI   → http://localhost:5173 (HMR)");
  console.log("  MCP  → http://127.0.0.1:4243/mcp");
  console.log("  prod → pnpm start -- --prod\n");
  supervise([
    run("node", ["bridge.mjs"]),
    run("pnpm", ["--filter", "ui", "dev"]),
    run("pnpm", ["mcp:start"]),
  ]);
}
