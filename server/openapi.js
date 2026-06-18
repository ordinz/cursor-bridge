import { PROMPT_MAX_LENGTH } from "./validate.js";
import { VERSION } from "./version.js";

const sessionSchema = {
  type: "object",
  required: [
    "sessionId",
    "agentId",
    "project",
    "cwd",
    "model",
    "runStatus",
    "runActive",
    "createdAt",
    "lastActivityAt",
  ],
  properties: {
    sessionId: { type: "string", format: "uuid" },
    agentId: { type: "string" },
    project: { type: "string" },
    cwd: { type: "string" },
    model: { type: "string" },
    name: { type: "string", nullable: true },
    runStatus: {
      type: "string",
      enum: ["idle", "running", "error", "cancelled", "finished"],
    },
    runActive: { type: "boolean" },
    createdAt: { type: "integer", description: "Unix ms" },
    lastActivityAt: { type: "integer", description: "Unix ms" },
    lastPrompt: { type: "string", nullable: true },
    lastAssistantSnippet: { type: "string", nullable: true },
    namedFromPrompt: { type: "boolean" },
  },
};

const errorSchema = {
  type: "object",
  required: ["error", "code"],
  properties: {
    error: { type: "string" },
    code: { type: "string" },
    sessionId: { type: "string" },
  },
};

const sseBase = {
  type: "object",
  required: ["type", "sessionId", "timestamp"],
  properties: {
    type: { type: "string" },
    sessionId: { type: "string", nullable: true },
    timestamp: { type: "string", format: "date-time" },
  },
};

export function buildOpenApiSpec(baseUrl = "http://127.0.0.1:4242") {
  return {
    openapi: "3.1.0",
    info: {
      title: "cursor-bridge Agent API",
      version: VERSION,
      description:
        "Localhost HTTP + SSE API for external browser agents. See AGENT_API.md for client guidance.",
    },
    servers: [{ url: `${baseUrl}/api` }],
    paths: {
      "/health": {
        get: {
          operationId: "getHealth",
          summary: "Bridge and Cursor connectivity status",
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      version: { type: "string" },
                      bridge: {
                        type: "object",
                        properties: {
                          status: { type: "string", enum: ["up"] },
                          host: { type: "string" },
                          port: { type: "integer" },
                        },
                      },
                      cursor: {
                        type: "object",
                        properties: {
                          apiKeyConfigured: { type: "boolean" },
                          ready: { type: "boolean" },
                          reason: { type: "string", nullable: true },
                        },
                      },
                      agents: {
                        type: "object",
                        properties: {
                          activeRuns: {
                            type: "integer",
                            description: "Sessions with an active agent run",
                          },
                          sessionCount: {
                            type: "integer",
                            description: "Open sessions in memory",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/projects": {
        get: {
          operationId: "listProjects",
          summary: "Allowed workspace projects",
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      projects: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            name: { type: "string" },
                            canCreateSession: { type: "boolean" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/sessions/{id}": {
        get: {
          operationId: "getSession",
          summary: "Session metadata and run state",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": { schema: sessionSchema },
              },
            },
            404: {
              description: "Session not found",
              content: {
                "application/json": { schema: errorSchema },
              },
            },
          },
        },
      },
      "/sessions": {
        post: {
          operationId: "createSession",
          summary: "Create a new agent session",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["project"],
                  properties: {
                    project: { type: "string", example: "app" },
                    model: { type: "string", default: "default" },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "Created",
              content: {
                "application/json": { schema: sessionSchema },
              },
            },
            400: {
              description: "Invalid project",
              content: {
                "application/json": { schema: errorSchema },
              },
            },
            403: {
              description: "Project disabled",
              content: {
                "application/json": { schema: errorSchema },
              },
            },
          },
        },
      },
      "/sessions/{id}/events": {
        get: {
          operationId: "watchSession",
          summary: "Watch session events (SSE fan-out from chat runs)",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "replay",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["0", "1"], default: "1" },
              description:
                "When 1, replay buffered events from the current run on connect",
            },
          ],
          responses: {
            200: {
              description:
                "SSE stream. Same event types as POST /chat. Comment heartbeats `: heartbeat` every 15s.",
              content: {
                "text/event-stream": {
                  schema: { type: "string" },
                },
              },
            },
            404: {
              description: "Session not found",
              content: { "application/json": { schema: errorSchema } },
            },
          },
        },
      },
      "/sessions/{id}/chat": {
        post: {
          operationId: "chat",
          summary: "Send a prompt; response is an SSE stream",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["prompt"],
                  properties: {
                    prompt: {
                      type: "string",
                      minLength: 1,
                      maxLength: PROMPT_MAX_LENGTH,
                    },
                    allowOverlap: {
                      type: "boolean",
                      default: false,
                    },
                    source: {
                      type: "string",
                      enum: ["api", "manual"],
                      default: "api",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description:
                "SSE stream. Events: session, status, user, assistant (deltas), tool_call, tool_result, error, done. Comment heartbeats `: heartbeat` every 15s.",
              content: {
                "text/event-stream": {
                  schema: {
                    type: "string",
                    description: "Newline-delimited SSE data lines",
                  },
                },
              },
            },
            400: { description: "Invalid prompt", content: { "application/json": { schema: errorSchema } } },
            404: { description: "Session not found", content: { "application/json": { schema: errorSchema } } },
            409: { description: "Session busy", content: { "application/json": { schema: errorSchema } } },
          },
        },
      },
      "/sessions/{id}/cancel": {
        post: {
          operationId: "cancelSession",
          summary: "Cancel the active run on a session",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            200: {
              description: "Run cancelled",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      sessionId: { type: "string" },
                      runStatus: { type: "string", enum: ["cancelled"] },
                    },
                  },
                },
              },
            },
            404: {
              description: "Session not found",
              content: { "application/json": { schema: errorSchema } },
            },
            409: {
              description: "No active run",
              content: { "application/json": { schema: errorSchema } },
            },
          },
        },
      },
      "/telegram": {
        post: {
          operationId: "sendTelegram",
          summary: "Send a message to the configured Telegram chat",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["message"],
                  properties: {
                    message: { type: "string", maxLength: 4096 },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Message sent",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      messageId: { type: "integer", nullable: true },
                    },
                  },
                },
              },
            },
            400: { description: "Invalid message", content: { "application/json": { schema: errorSchema } } },
            502: { description: "Telegram API error", content: { "application/json": { schema: errorSchema } } },
            503: { description: "Telegram not configured", content: { "application/json": { schema: errorSchema } } },
          },
        },
      },
      "/telegram/send": {
        post: {
          operationId: "sendTelegramLegacy",
          summary: "Send a message to the configured Telegram chat (alias)",
          deprecated: true,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["message"],
                  properties: {
                    message: { type: "string", maxLength: 4096 },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Message sent",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      messageId: { type: "integer", nullable: true },
                    },
                  },
                },
              },
            },
            400: { description: "Invalid message", content: { "application/json": { schema: errorSchema } } },
            502: { description: "Telegram API error", content: { "application/json": { schema: errorSchema } } },
            503: { description: "Telegram not configured", content: { "application/json": { schema: errorSchema } } },
          },
        },
      },
    },
    components: {
      schemas: {
        Session: sessionSchema,
        ApiError: errorSchema,
        SseEvent: sseBase,
      },
    },
    "x-sse-events": {
      assistant: {
        description:
          "Partial text delta — concatenate all assistant events in a turn to rebuild the full reply.",
        fields: { text: "string delta" },
      },
      done: {
        description: "Emitted exactly once at the end of a successful run.",
      },
      error: {
        description:
          "Emitted on stream failure. No done event follows an error.",
      },
      heartbeat: {
        description: "SSE comment line `: heartbeat` every 15 seconds during long runs.",
      },
    },
  };
}
