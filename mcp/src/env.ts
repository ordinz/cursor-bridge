import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Load repo-root `.env` (pnpm runs MCP from `mcp/`; dotenv is not automatic). */
export function loadRootEnv(): void {
  const envPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../.env",
  );
  if (!existsSync(envPath)) return;
  process.loadEnvFile(envPath);
}
