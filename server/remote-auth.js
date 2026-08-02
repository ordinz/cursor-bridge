import { isLocalHost } from "./tunnel-access.js";

export function readRemoteApiKey() {
  return (
    process.env.BRIDGE_API_KEY?.trim() ||
    process.env.MCP_API_KEY?.trim() ||
    undefined
  );
}

export function matchesApiKey(req, expected) {
  const auth = req.headers.authorization?.trim();
  if (auth === `Bearer ${expected}`) return true;
  if (auth === expected) return true;
  if (auth === `Bearer=${expected}`) return true;
  if (auth?.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim() === expected;
  }

  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.trim() === expected) return true;

  return false;
}

/** Require API key for any non-localhost request. Localhost stays open for dev. */
export function requireRemoteApiKey(req, res, next) {
  // Telegram webhook uses its own secret header — not Bearer API key.
  if (
    req.path === "/cursor-bridge/telegram/webhook" ||
    req.path.startsWith("/cursor-bridge/telegram/webhook")
  ) {
    next();
    return;
  }

  if (isLocalHost(req)) {
    next();
    return;
  }

  const expected = readRemoteApiKey();
  if (!expected) {
    res.status(503).json({
      error: "Remote access disabled: set MCP_API_KEY or BRIDGE_API_KEY",
      code: "REMOTE_ACCESS_DISABLED",
    });
    return;
  }

  if (!matchesApiKey(req, expected)) {
    res.status(401).json({
      error: "Unauthorized",
      code: "UNAUTHORIZED",
    });
    return;
  }

  next();
}
