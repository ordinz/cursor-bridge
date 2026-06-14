#!/usr/bin/env node

import { loadRootEnv } from "./env.js";
import { BridgeClient, assertLocalBaseUrl } from "./client.js";
import { startMcpHttpServer } from "./http-server.js";

loadRootEnv();

const DEFAULT_BASE_URL = "http://127.0.0.1:4242/api";
const baseUrl = process.env.BRIDGE_BASE_URL ?? DEFAULT_BASE_URL;
const bridgeApiKey =
  process.env.BRIDGE_API_KEY?.trim() ||
  process.env.MCP_API_KEY?.trim() ||
  undefined;

async function main(): Promise<void> {
  assertLocalBaseUrl(baseUrl);

  const bridgeClient = new BridgeClient(baseUrl, bridgeApiKey);

  try {
    const health = await bridgeClient.health();
    if (health.cursor.ready) {
      console.log(
        `Bridge reachable (v${health.version}, Cursor ready) at ${baseUrl}`,
      );
    } else {
      console.warn(
        `Bridge reachable but Cursor not ready: ${health.cursor.reason ?? "unknown"}`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Bridge health check failed: ${message}`);
    console.warn("Start the bridge first: pnpm bridge");
  }

  startMcpHttpServer({ bridgeClient });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
