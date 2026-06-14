import type { Request, Response, NextFunction } from "express";

function isLocalHost(req: Request): boolean {
  const host = (req.headers.host ?? "").split(":")[0].toLowerCase();
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]"
  );
}

export function readMcpApiKey(): string | undefined {
  const key =
    process.env.BRIDGE_API_KEY?.trim() ||
    process.env.MCP_API_KEY?.trim() ||
    "";
  return key || undefined;
}

function extractToken(req: Request, expected: string): boolean {
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

export function requireMcpApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isLocalHost(req)) {
    next();
    return;
  }

  const expected = readMcpApiKey();
  if (!expected) {
    res.status(503).json({
      jsonrpc: "2.0",
      error: {
        code: -32002,
        message: "Remote access disabled: set MCP_API_KEY or BRIDGE_API_KEY",
      },
      id: null,
    });
    return;
  }

  if (extractToken(req, expected)) {
    next();
    return;
  }

  res.status(401).json({
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message: "Unauthorized: invalid or missing Bearer token",
    },
    id: null,
  });
}
