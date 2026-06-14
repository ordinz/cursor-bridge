import http from "node:http";

const MCP_PORT = Number(process.env.MCP_PORT ?? 4243);

function proxyToMcpServer(req, res) {
  const headers = { ...req.headers };
  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: MCP_PORT,
      path: req.originalUrl,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    if (!res.headersSent) {
      res.status(502).json({
        error: "MCP server unavailable — run pnpm mcp:start",
        detail: err.message,
      });
    }
  });

  req.pipe(proxyReq);
}

/** Forward MCP HTTP routes on :4242 → MCP server on :4243 (for Cloudflare tunnel). */
export function mountMcpProxy(app) {
  app.all("/mcp", proxyToMcpServer);
  app.get("/sse", proxyToMcpServer);
  app.post("/messages", proxyToMcpServer);
  app.get("/mcp-health", (req, res) => {
    req.originalUrl = "/health";
    proxyToMcpServer(req, res);
  });
}
