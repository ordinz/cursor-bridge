import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "./client.js";
import type { HealthResponse } from "./types.js";
import { registerTools } from "./tools.js";

export const TOOL_CATALOG = [
  {
    name: "run_oneshot",
    description:
      "Default — create session, send one prompt, stream to completion, close. Best for single-turn coding tasks.",
  },
  {
    name: "health",
    description: "Bridge + Cursor connectivity; wait for cursor.ready before sessions.",
  },
  {
    name: "list_projects",
    description: "Allowlisted projects available for new sessions (e.g. app, www).",
  },
  {
    name: "list_models",
    description: "Cursor models available for your API key.",
  },
  {
    name: "create_session",
    description: "Start a multi-turn Cursor agent session for a project.",
  },
  {
    name: "resume_session",
    description: "Resume a persisted agent by agentId.",
  },
  {
    name: "get_session",
    description: "Poll session state (runStatus, runActive).",
  },
  {
    name: "list_agents",
    description: "List persisted local agents for a project.",
  },
  {
    name: "delete_agent",
    description: "Delete a persisted agent and its checkpoints.",
  },
  {
    name: "send_prompt",
    description: "Send a prompt and wait for the full SSE stream (assistant text + tool calls).",
  },
  {
    name: "cancel_run",
    description: "Cancel the active run on a session.",
  },
  {
    name: "close_session",
    description: "Cancel any active run and close a session.",
  },
  {
    name: "about",
    description:
      "Connector overview: project scope, bridge status, and full tool catalog (call on first use).",
  },
] as const;

export interface LiveMeta {
  health?: HealthResponse;
  projects?: Array<{
    id: string;
    enabled: boolean;
    canCreateSession: boolean;
    path?: string;
  }>;
  bridgeReachable: boolean;
}

export async function fetchLiveMeta(client: BridgeClient): Promise<LiveMeta> {
  try {
    const health = await client.health();
    let projects: LiveMeta["projects"] = [];
    try {
      projects = await client.listProjects();
    } catch {
      // projects optional if Cursor not ready
    }
    return { health, projects, bridgeReachable: true };
  } catch {
    return { bridgeReachable: false, projects: [] };
  }
}

export function buildAboutManifest(meta: LiveMeta) {
  const projectIds =
    meta.projects?.map((p) => p.id).join(", ") || "app, www (default allowlist)";
  const cursorReady = meta.health?.cursor.ready ?? false;
  const cursorReason = meta.health?.cursor.reason;

  return {
    name: "cursor-bridge",
    title: "Cursor Bridge — local Cursor coding agent",
    version: meta.health?.version ?? "1.0.0",
    summary:
      "Dispatches coding tasks to Cursor agents on the developer Mac. Works inside ~/dev/mx/https (projects: app, www by default).",
    bridgeReachable: meta.bridgeReachable,
    cursor: {
      ready: cursorReady,
      reason: cursorReason ?? null,
      apiKeyConfigured: meta.health?.cursor.apiKeyConfigured ?? null,
    },
    projects: meta.projects ?? [],
    defaultProject: "app",
    defaultTool: "run_oneshot",
    toolCount: TOOL_CATALOG.length,
    tools: TOOL_CATALOG,
    requirements: [
      "Bridge running locally: pnpm bridge (http://127.0.0.1:4242/api)",
      "MCP server: pnpm mcp:start (proxied at /mcp on the tunnel)",
      "Developer machine must stay on with Cursor API key configured",
    ],
    quickStart: {
      oneShot: { tool: "run_oneshot", project: "app", prompt: "Summarize the app repo" },
      multiTurn: ["create_session", "send_prompt", "close_session"],
      check: { tool: "health", note: "Proceed only when cursor.ready is true" },
    },
  };
}

export function buildInstructions(meta: LiveMeta): string {
  const manifest = buildAboutManifest(meta);
  const projectIds =
    meta.projects?.map((p) => p.id).join(", ") ||
    "app, www (default allowlist)";
  const toolLines = TOOL_CATALOG.map(
    (t) => `- **${t.name}** — ${t.description}`,
  ).join("\n");

  return `# Cursor Bridge MCP

${manifest.summary}

## Status
- Bridge reachable: ${manifest.bridgeReachable ? "yes" : "no — start \`pnpm bridge\` on the Mac"}
- Cursor ready: ${manifest.cursor.ready ? "yes" : "no"}${manifest.cursor.reason ? ` (${manifest.cursor.reason})` : ""}
- Enabled projects: ${projectIds}

## How to use (Perplexity)
1. Prefer **run_oneshot** for one-off coding tasks (\`project\`: \`app\` or \`www\`).
2. Call **health** if Cursor may not be ready.
3. Use **create_session** → **send_prompt** → **close_session** for multi-turn work.
4. Read resource **cursor-bridge://about** or call tool **about** for this manifest.

## Tools (${TOOL_CATALOG.length})
${toolLines}

## Scope
Agents may only modify code under the developer's allowlisted projects (typically \`app\` and \`www\` in \`~/dev/mx/https\`). Do not expose secrets in prompts.`;
}

export function registerServerMeta(
  server: McpServer,
  client: BridgeClient,
  meta: LiveMeta,
): void {
  const manifest = buildAboutManifest(meta);
  const manifestJson = JSON.stringify(manifest, null, 2);

  server.registerResource(
    "about",
    "cursor-bridge://about",
    {
      title: "Cursor Bridge connector overview",
      description:
        "Project scope, bridge/Cursor status, quick-start, and full MCP tool catalog for Perplexity.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "cursor-bridge://about",
          mimeType: "application/json",
          text: manifestJson,
        },
      ],
    }),
  );

  server.registerResource(
    "tools",
    "cursor-bridge://tools",
    {
      title: "Cursor Bridge MCP tools",
      description: "JSON list of all MCP tools with descriptions and JSON Schema via tools/list.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "cursor-bridge://tools",
          mimeType: "application/json",
          text: JSON.stringify({ tools: TOOL_CATALOG }, null, 2),
        },
      ],
    }),
  );

  server.registerPrompt(
    "connector-overview",
    {
      title: "Cursor Bridge connector overview",
      description:
        "Human-readable summary of this MCP connector for Perplexity on first connect.",
    },
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: buildInstructions(meta),
          },
        },
      ],
    }),
  );

  server.tool(
    "about",
    "Return connector overview JSON: projects, Cursor status, quick-start, and all tool names.",
    {},
    async () => {
      let live = meta;
      try {
        live = await fetchLiveMeta(client);
      } catch {
        // use cached meta from session init
      }
      const fresh = buildAboutManifest(live);
      return {
        content: [
          {
            type: "text" as const,
            text: `Cursor Bridge connector\n\n${JSON.stringify(fresh, null, 2)}`,
          },
        ],
      };
    },
  );
}

export async function createConfiguredMcpServer(
  client: BridgeClient,
): Promise<McpServer> {
  const meta = await fetchLiveMeta(client);
  const server = new McpServer(
    {
      name: "cursor-bridge",
      version: meta.health?.version ?? "1.0.0",
    },
    {
      instructions: buildInstructions(meta),
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );
  registerServerMeta(server, client, meta);
  registerTools(server, client);
  return server;
}
