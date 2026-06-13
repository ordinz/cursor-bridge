import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BridgeClient } from "./client.js";
import { BridgeError } from "./types.js";
import type { ChatStreamResult } from "./types.js";

const MAX_RESPONSE_BYTES = 25 * 1024;

const FILE_TOOL_NAMES = new Set([
  "read",
  "write",
  "edit",
  "search_replace",
  "delete",
  "glob",
  "grep",
]);

function extractTouchedFiles(toolCalls: ChatStreamResult["toolCalls"]): string[] {
  const paths = new Set<string>();
  for (const call of toolCalls) {
    if (!FILE_TOOL_NAMES.has(call.name)) continue;
    const args = call.args as Record<string, unknown> | undefined;
    if (typeof args?.path === "string") paths.add(args.path);
    if (typeof args?.target_file === "string") paths.add(args.target_file);
    if (typeof args?.file_path === "string") paths.add(args.file_path);
  }
  return [...paths];
}

function synopsis(text: string, maxLen = 200): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen - 1)}…`;
}

function buildChatSummary(result: ChatStreamResult): string {
  const files = extractTouchedFiles(result.toolCalls);
  const parts: string[] = [];

  if (result.status === "error") {
    parts.push(`Run failed: ${result.errorMessage ?? "unknown error"}`);
  } else if (result.status === "cancelled") {
    parts.push("Run was cancelled.");
  } else {
    parts.push("Run finished successfully.");
  }

  if (files.length > 0) {
    parts.push(`Files touched: ${files.join(", ")}`);
  } else if (result.toolCalls.length > 0) {
    parts.push(
      `Tools used: ${[...new Set(result.toolCalls.map((t) => t.name))].join(", ")}`,
    );
  }

  if (result.assistantText.trim()) {
    parts.push(synopsis(result.assistantText));
  }

  return parts.join("\n");
}

function truncateResponse(
  summary: string,
  payload: Record<string, unknown>,
): { text: string; truncated: boolean } {
  const full = `${summary}\n\n${JSON.stringify(payload, null, 2)}`;
  if (Buffer.byteLength(full, "utf8") <= MAX_RESPONSE_BYTES) {
    return { text: full, truncated: false };
  }

  const clipped = { ...payload, truncated: true };
  let json = JSON.stringify(clipped, null, 2);
  let combined = `${summary}\n\n${json}`;

  while (
    Buffer.byteLength(combined, "utf8") > MAX_RESPONSE_BYTES &&
    json.length > 100
  ) {
    json = json.slice(0, Math.floor(json.length * 0.85));
    combined = `${summary}\n\n${json}\n... [response truncated]`;
  }

  return { text: combined, truncated: true };
}

function okContent(summary: string, data: Record<string, unknown>) {
  const { text } = truncateResponse(summary, data);
  return { content: [{ type: "text" as const, text }] };
}

function errContent(err: unknown) {
  if (err instanceof BridgeError) {
    return {
      content: [
        {
          type: "text" as const,
          text: `${err.code}: ${err.message}`,
        },
      ],
      isError: true as const,
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `BRIDGE_ERROR: ${message}` }],
    isError: true as const,
  };
}

export function registerTools(server: McpServer, client: BridgeClient): void {
  server.tool(
    "health",
    "Check cursor-bridge and Cursor SDK connectivity. Wait until cursor.ready is true before creating sessions.",
    {},
    async () => {
      try {
        const health = await client.health();
        if (!health.cursor.ready) {
          const reason = health.cursor.reason ?? "Cursor is not ready";
          return {
            content: [
              {
                type: "text",
                text: `CURSOR_NOT_READY: ${reason}`,
              },
            ],
            isError: true,
          };
        }
        return okContent("Bridge is healthy and Cursor is ready.", { health });
      } catch (err) {
        return errContent(err);
      }
    },
  );

  server.tool(
    "list_projects",
    "List allowlisted projects available for new Cursor agent sessions.",
    {},
    async () => {
      try {
        const projects = await client.listProjects();
        return okContent(`${projects.length} project(s) available.`, {
          projects,
        });
      } catch (err) {
        return errContent(err);
      }
    },
  );

  server.tool(
    "list_models",
    "List Cursor models available for your API key.",
    {},
    async () => {
      try {
        const models = await client.listModels();
        return okContent(`${models.length} model(s) available.`, { models });
      } catch (err) {
        return errContent(err);
      }
    },
  );

  server.tool(
    "create_session",
    "Create a new multi-turn Cursor agent session for a project.",
    {
      project: z.string().describe("Project id (e.g. app, www)"),
      model: z
        .string()
        .optional()
        .default("default")
        .describe("Model id from list_models"),
    },
    async ({ project, model }) => {
      try {
        const session = await client.createSession(project, model);
        return okContent(`Session ${session.sessionId} created.`, {
          sessionId: session.sessionId,
          agentId: session.agentId,
          project: session.project,
          cwd: session.cwd,
          model: session.model,
        });
      } catch (err) {
        return errContent(err);
      }
    },
  );

  server.tool(
    "resume_session",
    "Resume a persisted Cursor agent by agentId.",
    {
      agentId: z.string().describe("Agent id from a previous session"),
      project: z.string().describe("Project id the agent belongs to"),
      model: z.string().optional().describe("Optional model override"),
    },
    async ({ agentId, project, model }) => {
      try {
        const session = await client.resumeSession(agentId, project, model);
        return okContent(`Session ${session.sessionId} resumed.`, {
          sessionId: session.sessionId,
          agentId: session.agentId,
          project: session.project,
          cwd: session.cwd,
          model: session.model,
        });
      } catch (err) {
        return errContent(err);
      }
    },
  );

  server.tool(
    "get_session",
    "Get current session state (runStatus, runActive, last prompt snippet).",
    {
      sessionId: z.string().describe("Bridge session id"),
    },
    async ({ sessionId }) => {
      try {
        const session = await client.getSession(sessionId);
        return okContent(`Session ${sessionId} is ${session.runStatus}.`, {
          session,
        });
      } catch (err) {
        return errContent(err);
      }
    },
  );

  server.tool(
    "list_agents",
    "List persisted local agents for a project.",
    {
      project: z.string().describe("Project id"),
    },
    async ({ project }) => {
      try {
        const agents = await client.listAgents(project);
        return okContent(`${agents.length} agent(s) for ${project}.`, {
          agents,
        });
      } catch (err) {
        return errContent(err);
      }
    },
  );

  server.tool(
    "delete_agent",
    "Delete a persisted local agent and its runs/checkpoints.",
    {
      agentId: z.string().describe("Agent id to delete"),
      project: z.string().describe("Project id"),
    },
    async ({ agentId, project }) => {
      try {
        const result = await client.deleteAgent(agentId, project);
        return okContent(`Agent ${agentId} deleted.`, result);
      } catch (err) {
        return errContent(err);
      }
    },
  );

  server.tool(
    "send_prompt",
    "Send a prompt to a session and wait for the SSE stream to complete. Returns assistant text, tool calls, and run status.",
    {
      sessionId: z.string().describe("Bridge session id"),
      prompt: z.string().min(1).describe("User/agent message"),
      allowOverlap: z
        .boolean()
        .optional()
        .default(false)
        .describe("Allow overlapping runs on the same session"),
    },
    async ({ sessionId, prompt, allowOverlap }) => {
      try {
        const result = await client.streamChat(
          sessionId,
          prompt,
          allowOverlap,
        );
        const summary = buildChatSummary(result);
        return okContent(summary, result as unknown as Record<string, unknown>);
      } catch (err) {
        return errContent(err);
      }
    },
  );

  server.tool(
    "cancel_run",
    "Cancel the active run on a session.",
    {
      sessionId: z.string().describe("Bridge session id"),
    },
    async ({ sessionId }) => {
      try {
        const result = await client.cancelRun(sessionId);
        return okContent(`Run cancelled for session ${sessionId}.`, result);
      } catch (err) {
        return errContent(err);
      }
    },
  );

  server.tool(
    "close_session",
    "Cancel any active run and close a session.",
    {
      sessionId: z.string().describe("Bridge session id"),
    },
    async ({ sessionId }) => {
      try {
        await client.closeSession(sessionId);
        return okContent(`Session ${sessionId} closed.`, { ok: true, sessionId });
      } catch (err) {
        return errContent(err);
      }
    },
  );

  server.tool(
    "run_oneshot",
    "Default tool: create a session, send one prompt, stream to completion, and close the session. Best for single-turn tasks.",
    {
      project: z.string().describe("Project id (e.g. app, www)"),
      prompt: z.string().min(1).describe("Task prompt for the Cursor agent"),
      model: z
        .string()
        .optional()
        .default("default")
        .describe("Model id from list_models"),
    },
    async ({ project, prompt, model }) => {
      let sessionId: string | undefined;
      try {
        const session = await client.createSession(project, model);
        sessionId = session.sessionId;
        const result = await client.streamChat(sessionId, prompt, false);
        const summary = buildChatSummary(result);
        return okContent(summary, {
          sessionId,
          agentId: session.agentId,
          ...(result as unknown as Record<string, unknown>),
        });
      } catch (err) {
        return errContent(err);
      } finally {
        if (sessionId) {
          try {
            await client.closeSession(sessionId);
          } catch {
            // best-effort cleanup
          }
        }
      }
    },
  );
}
