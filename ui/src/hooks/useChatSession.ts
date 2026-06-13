import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelSession,
  createSession,
  getAgentHistory,
  getSession,
  resumeSession,
} from "../lib/api";
import { postChat, readSseStream } from "../lib/sse";
import type { FeedItem, Session, SseEvent } from "../lib/types";

export const SESSION_STORAGE_KEY = "cursor-bridge-active-session-v1";

let itemCounter = 0;
function nextId() {
  return `item-${++itemCounter}`;
}

function applyEvent(items: FeedItem[], event: SseEvent): FeedItem[] {
  const next = [...items];

  switch (event.type) {
    case "user":
      next.push({
        id: nextId(),
        kind: "user",
        text: event.text,
        source:
          event.source === "manual" ||
          event.source === "api" ||
          event.source === "history"
            ? event.source
            : undefined,
      });
      break;
    case "assistant": {
      const last = next[next.length - 1];
      if (last?.kind === "assistant") {
        next[next.length - 1] = {
          ...last,
          text: last.text + event.text,
        };
      } else {
        next.push({ id: nextId(), kind: "assistant", text: event.text });
      }
      break;
    }
    case "tool_call": {
      const callId = event.callId ?? nextId();
      const idx = next.findIndex(
        (i) => i.kind === "tool" && i.callId === callId,
      );
      const toolItem: FeedItem = {
        id: callId,
        kind: "tool",
        callId,
        name: event.name,
        status: event.status === "running" ? "running" : "completed",
        args: event.args,
      };
      if (idx >= 0) {
        next[idx] = { ...next[idx], ...toolItem };
      } else {
        next.push(toolItem);
      }
      break;
    }
    case "tool_result": {
      const callId = event.callId ?? nextId();
      const idx = next.findIndex(
        (i) => i.kind === "tool" && i.callId === callId,
      );
      const toolItem: FeedItem = {
        id: callId,
        kind: "tool",
        callId,
        name: event.name,
        status: event.status === "error" ? "error" : "completed",
        result: event.result,
      };
      if (idx >= 0) {
        next[idx] = { ...next[idx], ...toolItem };
      } else {
        next.push(toolItem);
      }
      break;
    }
    case "status":
      next.push({
        id: nextId(),
        kind: "status",
        status: event.status,
        message: event.message,
      });
      break;
    case "error":
      next.push({ id: nextId(), kind: "error", message: event.message });
      break;
    default:
      break;
  }

  return next;
}

export function useChatSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [runStatus, setRunStatus] = useState<string>("idle");
  const [error, setError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!session) return;
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        agentId: session.agentId,
        project: session.project,
        model: session.model,
      }),
    );
  }, [session]);

  useEffect(() => {
    if (!session?.sessionId) return;
    if (runStatus === "running") return;

    const id = session.sessionId;
    const interval = window.setInterval(() => {
      void getSession(id)
        .then((s) => {
          setSession((prev) => (prev?.sessionId === id ? s : prev));
          setRunStatus((prev) =>
            prev === "running" ? prev : (s.runStatus as string),
          );
        })
        .catch(() => undefined);
    }, 3000);

    return () => window.clearInterval(interval);
  }, [session?.sessionId, runStatus]);

  const startSession = useCallback(
    async (project: string, model: string) => {
      setError(null);
      setFeed([]);
      const s = await createSession(project, model);
      setSession(s);
      setRunStatus(s.runStatus);
      return s;
    },
    [],
  );

  const resumeAgent = useCallback(
    async (agentId: string, project: string, model: string) => {
      setError(null);
      setHistoryLoading(true);
      try {
        const [s, history] = await Promise.all([
          resumeSession(agentId, project, model),
          getAgentHistory(agentId, project).catch(() => ({ items: [] as FeedItem[] })),
        ]);
        setFeed(history.items);
        setSession(s);
        setRunStatus(s.runStatus);
        return s;
      } finally {
        setHistoryLoading(false);
      }
    },
    [],
  );

  const clearSession = useCallback(() => {
    setSession(null);
    setFeed([]);
    setRunStatus("idle");
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }, []);

  const sendPrompt = useCallback(
    async (prompt: string, source = "manual", sessionOverride?: Session) => {
      const active = sessionOverride ?? session;
      if (!active) {
        throw new Error("No active session");
      }

      setError(null);
      setRunStatus("running");
      setFeed((items) => [
        ...items,
        {
          id: nextId(),
          kind: "user",
          text: prompt,
          source:
            source === "manual" || source === "api" || source === "history"
              ? source
              : undefined,
        },
      ]);

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        const res = await postChat(active.sessionId, prompt);

        for await (const event of readSseStream(res)) {
          if (event.type === "session") {
            setSession((prev) =>
              prev
                ? {
                    ...prev,
                    sessionId: event.sessionId ?? prev.sessionId,
                    agentId: event.agentId,
                    name: event.name ?? prev.name,
                    runStatus: event.runStatus ?? prev.runStatus,
                    runActive: event.runActive ?? prev.runActive,
                    lastActivityAt: Date.parse(event.timestamp) || prev.lastActivityAt,
                  }
                : prev,
            );
          } else if (event.type === "done") {
            const status =
              event.status === "finished" ? "idle" : event.status;
            setRunStatus(status);
            setSession((prev) =>
              prev
                ? {
                    ...prev,
                    runStatus: status,
                    runActive: false,
                    lastActivityAt: Date.parse(event.timestamp) || prev.lastActivityAt,
                  }
                : prev,
            );
          } else {
            setFeed((items) => applyEvent(items, event));
          }
        }
        setRunStatus("idle");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Chat failed";
        setError(message);
        setFeed((items) => [
          ...items,
          { id: nextId(), kind: "error", message },
        ]);
        setRunStatus("error");
        setSession((prev) =>
          prev ? { ...prev, runStatus: "error", runActive: false } : prev,
        );
      }
    },
    [session],
  );

  const stopRun = useCallback(async () => {
    if (!session) return;
    try {
      await cancelSession(session.sessionId);
      setRunStatus("cancelled");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
  }, [session]);

  return {
    session,
    feed,
    runStatus,
    error,
    historyLoading,
    startSession,
    resumeAgent,
    sendPrompt,
    stopRun,
    setSession,
    clearSession,
  };
}
