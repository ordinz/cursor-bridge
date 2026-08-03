import type { SseEvent } from "./types";

export type SessionSocketStatus = "connecting" | "open" | "closed";

export function sessionWebSocketUrl(
  sessionId: string,
  options: { replay?: boolean; afterSeq?: number } = {},
): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams();
  if (options.replay === false) params.set("replay", "0");
  if (options.afterSeq != null && options.afterSeq > 0) {
    params.set("after", String(options.afterSeq));
  }
  const qs = params.toString();
  return `${proto}//${window.location.host}/api/sessions/${encodeURIComponent(sessionId)}/ws${qs ? `?${qs}` : ""}`;
}

export type SessionSocketHandlers = {
  onEvent: (event: SseEvent) => void;
  onStatus?: (status: SessionSocketStatus) => void;
  /** When true, request buffer replay on this connect. */
  getReplay?: () => boolean;
  /** Resume after this seq (skips already-seen events). */
  getAfterSeq?: () => number;
};

/**
 * Reconnecting session event socket. Feed updates should come from here
 * (chat POST SSE is only for request lifecycle).
 */
export function connectSessionSocket(
  sessionId: string,
  handlers: SessionSocketHandlers,
): { close: () => void; reconnect: () => void } {
  let closed = false;
  let socket: WebSocket | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let clientPingTimer: ReturnType<typeof setInterval> | null = null;

  const clearTimers = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (clientPingTimer) {
      clearInterval(clientPingTimer);
      clientPingTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (closed) return;
    const delay = Math.min(1000 * 2 ** attempt, 15_000);
    attempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  };

  const connect = () => {
    if (closed) return;
    clearTimers();
    handlers.onStatus?.("connecting");

    const replay = handlers.getReplay?.() ?? true;
    const afterSeq = handlers.getAfterSeq?.() ?? 0;
    const url = sessionWebSocketUrl(sessionId, { replay, afterSeq });

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.error("Session WebSocket failed to open:", err);
      handlers.onStatus?.("closed");
      scheduleReconnect();
      return;
    }

    socket = ws;

    ws.onopen = () => {
      if (closed || socket !== ws) return;
      attempt = 0;
      handlers.onStatus?.("open");
      clientPingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "ping" }));
          } catch {
            /* ignore */
          }
        }
      }, 25_000);
    };

    ws.onmessage = (msg) => {
      if (closed || socket !== ws) return;
      let data: unknown;
      try {
        data = JSON.parse(String(msg.data));
      } catch {
        return;
      }
      if (!data || typeof data !== "object") return;
      const event = data as SseEvent & { type: string };
      if (event.type === "pong") return;
      handlers.onEvent(event);
    };

    ws.onerror = () => {
      // onclose handles reconnect
    };

    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      clearTimers();
      handlers.onStatus?.("closed");
      if (!closed) scheduleReconnect();
    };
  };

  connect();

  return {
    close: () => {
      closed = true;
      clearTimers();
      handlers.onStatus?.("closed");
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      socket = null;
    },
    reconnect: () => {
      if (closed) return;
      attempt = 0;
      clearTimers();
      const prev = socket;
      socket = null;
      if (prev) {
        try {
          prev.onclose = null;
          prev.close();
        } catch {
          /* ignore */
        }
      }
      connect();
    },
  };
}
