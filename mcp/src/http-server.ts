import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { BridgeClient } from "./client.js";
import { requireMcpApiKey } from "./auth.js";
import { createConfiguredMcpServer } from "./server-meta.js";

type ActiveTransport =
  | StreamableHTTPServerTransport
  | SSEServerTransport;

async function connectMcpServer(
  bridgeClient: BridgeClient,
  transport: ActiveTransport,
): Promise<void> {
  const server = await createConfiguredMcpServer(bridgeClient);
  await server.connect(transport);
}

function jsonRpcError(res: import("express").Response, status: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
}

export interface McpHttpServerOptions {
  bridgeClient: BridgeClient;
  host?: string;
  port?: number;
  allowedHosts?: string[];
}

export function startMcpHttpServer(options: McpHttpServerOptions): HttpServer {
  const host = options.host ?? process.env.MCP_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.MCP_PORT ?? 4243);
  const allowedHosts =
    options.allowedHosts ??
    (process.env.MCP_ALLOWED_HOSTS
      ? [
          ...process.env.MCP_ALLOWED_HOSTS.split(",")
            .map((h) => h.trim())
            .filter(Boolean),
          "127.0.0.1",
          "localhost",
        ]
      : undefined);

  const app = createMcpExpressApp({ host, allowedHosts });
  const transports: Record<string, ActiveTransport> = {};

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "cursor-bridge-mcp",
      transports: {
        streamableHttp: "/mcp",
        sse: "/sse",
        sseMessages: "/messages",
      },
    });
  });

  app.get("/", (_req, res) => {
    res.json({
      ok: true,
      service: "cursor-bridge-mcp",
      mcp: "/mcp",
      health: "/health",
      sse: "/sse",
      sseMessages: "/messages",
      note: "MCP clients should POST to /mcp (Streamable HTTP). This root URL is for humans only.",
    });
  });

  app.use(requireMcpApiKey);

  app.all("/mcp", async (req, res) => {
    try {
      const rawSessionId = req.headers["mcp-session-id"];
      const sessionId = Array.isArray(rawSessionId)
        ? rawSessionId[0]
        : rawSessionId;
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && transports[sessionId]) {
        const existing = transports[sessionId];
        if (existing instanceof StreamableHTTPServerTransport) {
          transport = existing;
        } else {
          jsonRpcError(
            res,
            400,
            "Bad Request: Session exists but uses a different transport protocol",
          );
          return;
        }
      } else if (
        !sessionId &&
        req.method === "POST" &&
        isInitializeRequest(req.body)
      ) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            if (transport) transports[sid] = transport;
          },
        });
        transport.onclose = () => {
          const sid = transport?.sessionId;
          if (sid && transports[sid]) delete transports[sid];
        };
        await connectMcpServer(options.bridgeClient, transport);
      } else {
        jsonRpcError(res, 400, "Bad Request: No valid session ID provided");
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        jsonRpcError(res, 500, "Internal server error");
      }
      console.error("MCP streamable HTTP error:", err);
    }
  });

  app.get("/sse", async (req, res) => {
    try {
      const transport = new SSEServerTransport("/messages", res);
      transports[transport.sessionId] = transport;
      res.on("close", () => {
        delete transports[transport.sessionId];
      });
      await connectMcpServer(options.bridgeClient, transport);
    } catch (err) {
      console.error("MCP SSE error:", err);
      if (!res.headersSent) res.status(500).end();
    }
  });

  app.post("/messages", async (req, res) => {
    try {
      const sessionId = String(req.query.sessionId ?? "");
      const existing = transports[sessionId];
      if (!(existing instanceof SSEServerTransport)) {
        jsonRpcError(
          res,
          400,
          "Bad Request: No SSE session found for sessionId",
        );
        return;
      }
      await existing.handlePostMessage(req, res, req.body);
    } catch (err) {
      console.error("MCP SSE message error:", err);
      if (!res.headersSent) jsonRpcError(res, 500, "Internal server error");
    }
  });

  const httpServer = app.listen(port, host, () => {
    console.log(`cursor-bridge MCP HTTP listening on http://${host}:${port}`);
    console.log(`  Streamable HTTP → http://${host}:${port}/mcp`);
    console.log(`  Legacy SSE      → GET http://${host}:${port}/sse`);
    if (process.env.MCP_API_KEY || process.env.BRIDGE_API_KEY) {
      console.log("  Auth            → Bearer key required for non-localhost");
    } else {
      console.warn(
        "  Auth            → No API key set; remote access will be rejected",
      );
    }
    if (allowedHosts?.length) {
      console.log(`  Allowed Hosts   → ${allowedHosts.join(", ")}`);
    }
  });

  const shutdown = async () => {
    for (const sid of Object.keys(transports)) {
      try {
        await transports[sid]?.close();
      } catch {
        // ignore
      }
      delete transports[sid];
    }
    httpServer.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return httpServer;
}
