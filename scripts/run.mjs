import { spawn } from "node:child_process";

const prod = process.argv.includes("--prod");

function run(command, args) {
  return spawn(command, args, {
    stdio: "inherit",
    env: process.env,
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

if (prod) {
  console.log("cursor-bridge: prod mode — build UI, serve on http://127.0.0.1:4242");
  await wait(run("pnpm", ["--filter", "ui", "build"]));
  const bridge = run("node", ["bridge.mjs"]);
  bridge.on("exit", (code) => process.exit(code ?? 0));
} else {
  console.log("cursor-bridge: dev mode");
  console.log("  API  → http://127.0.0.1:4242/api/*");
  console.log("  UI   → http://localhost:5173 (HMR)");
  console.log("  prod → pnpm start -- --prod\n");

  const bridge = run("node", ["bridge.mjs"]);
  const ui = run("pnpm", ["--filter", "ui", "dev"]);

  const shutdown = () => {
    bridge.kill("SIGTERM");
    ui.kill("SIGTERM");
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  bridge.on("exit", (code) => {
    ui.kill("SIGTERM");
    process.exit(code ?? 0);
  });
  ui.on("exit", (code) => {
    bridge.kill("SIGTERM");
    process.exit(code ?? 0);
  });
}
