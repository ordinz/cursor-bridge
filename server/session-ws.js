import { WebSocketServer } from "ws";
import { matchesApiKey, readRemoteApiKey } from "./remote-auth.js";
import { isLocalHost } from "./tunnel-access.js";
import { validateSessionId } from "./validate.js";

const WS_PATH_RE = /^\/api\/sessions\/([^/]+)\/ws\/?$/;
const PING_INTERVAL_MS = 20_000;

/**
 * @param {import("http").IncomingMessage} req
 * @returns {{ ok: true } | { ok: false, status: number, message: string, code: string }}
 */
function authorizeUpgrade(req) {
  if (isLocalHost(req)) return { ok: true };

  const expected = readRemoteApiKey();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      message: "Remote access disabled: set MCP_API_KEY or BRIDGE_API_KEY",
      code: "REMOTE_ACCESS_DISABLED",
    };
  }

  if (!matchesApiKey(req, expected)) {
    return {
      ok: false,
      status: 401,
      message: "Unauthorized",
      code: "UNAUTHORIZED",
    };
  }

  return { ok: true };
}

/**
 * Attach session event WebSockets to an HTTP server.
 * Path: `/api/sessions/:id/ws?replay=1&after=0`
 *
 * @param {import("http").Server} server
 * @param {import("./sessions.js").SessionManager} sessions
 */
export function attachSessionWebSocket(server, sessions) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    try {
      const host = req.headers.host || "127.0.0.1";
      const url = new URL(req.url || "/", `http://${host}`);
      const match = WS_PATH_RE.exec(url.pathname);
      if (!match) {
        socket.destroy();
        return;
      }

      const auth = authorizeUpgrade(req);
      if (!auth.ok) {
        socket.write(
          `HTTP/1.1 ${auth.status} ${auth.message}\r\nConnection: close\r\n\r\n`,
        );
        socket.destroy();
        return;
      }

      let sessionId;
      try {
        sessionId = validateSessionId(decodeURIComponent(match[1]));
      } catch {
        socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      try {
        sessions.require(sessionId);
      } catch {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      const replay = url.searchParams.get("replay") !== "0";
      const afterRaw = url.searchParams.get("after");
      const afterSeq = afterRaw != null ? Number(afterRaw) || 0 : 0;

      wss.handleUpgrade(req, socket, head, (ws) => {
        const unsubscribe = sessions.events.subscribeWs(sessionId, ws, {
          replay,
          afterSeq,
        });

        const pingTimer = setInterval(() => {
          if (ws.readyState === ws.OPEN) {
            try {
              ws.ping();
            } catch {
              /* ignore */
            }
          }
        }, PING_INTERVAL_MS);
        if (typeof pingTimer.unref === "function") pingTimer.unref();

        ws.on("message", (data) => {
          let msg;
          try {
            msg = JSON.parse(String(data));
          } catch {
            return;
          }
          if (msg?.type === "ping") {
            try {
              ws.send(JSON.stringify({ type: "pong", t: Date.now() }));
            } catch {
              /* ignore */
            }
          }
        });

        const cleanup = () => {
          clearInterval(pingTimer);
          unsubscribe();
        };
        ws.on("close", cleanup);
        ws.on("error", cleanup);
      });
    } catch {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    }
  });

  return wss;
}
