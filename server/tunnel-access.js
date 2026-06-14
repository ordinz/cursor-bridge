const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

const PUBLIC_PATH_PREFIXES = [
  "/api",
  "/mcp",
  "/mcp-health",
  "/sse",
  "/messages",
  "/prompt",
];

export function isLocalHost(req) {
  const host = (req.headers.host ?? "").split(":")[0].toLowerCase();
  return LOCAL_HOSTS.has(host);
}

function isPublicPath(path) {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** Block oversight UI on tunnel/public hostnames; keep API + MCP routes. */
export function blockPublicUi(req, res, next) {
  if (isLocalHost(req) || isPublicPath(req.path)) {
    next();
    return;
  }

  if (req.method === "GET" && req.path === "/") {
    res.json({
      ok: true,
      service: "cursor-bridge",
      api: "/api",
      mcp: "/mcp",
      health: "/mcp-health",
    });
    return;
  }

  res.status(404).json({ error: "Not found" });
}

/** Wrap static/SPA handlers so they only run for localhost. */
export function localUiOnly(req, res, next) {
  if (isLocalHost(req)) {
    next();
    return;
  }
  next("route");
}
