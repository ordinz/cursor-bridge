#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeClient, assertLocalBaseUrl } from "./client.js";
import { registerTools } from "./tools.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:4242/api";
const baseUrl = process.env.BRIDGE_BASE_URL ?? DEFAULT_BASE_URL;

function logStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function main(): Promise<void> {
  assertLocalBaseUrl(baseUrl);

  const client = new BridgeClient(baseUrl);

  try {
    const health = await client.health();
    if (health.cursor.ready) {
      logStderr(
        `cursor-bridge MCP ready (bridge v${health.version}, Cursor ready)`,
      );
    } else {
      const reason = health.cursor.reason ?? "unknown";
      logStderr(
        `cursor-bridge MCP started but Cursor is not ready: ${reason}`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logStderr(
      `cursor-bridge MCP started but health check failed: ${message}`,
    );
    logStderr(
      "Ensure the bridge is running: pnpm start (http://127.0.0.1:4242/api)",
    );
  }

  const server = new McpServer({
    name: "cursor-bridge",
    version: "1.0.0",
  });

  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  logStderr(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
