import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  ApiError,
  cancelSession,
  createSession,
  getAgentHistory,
  getSession,
  resumeSession,
} from "../lib/api";
import { postChat, readSseStream } from "../lib/sse";
import type { FeedItem, Session, SseEvent } from "../lib/types";

export const SESSION_STORAGE_KEY = "cursor-bridge-active-session-v1";
/** Full session+feed snapshot so a discarded mobile tab restores without a blank flash. */
export const SESSION_SNAPSHOT_KEY = "cursor-bridge-session-snapshot-v1";

const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type SessionSnapshot = {
  session: Session;
  feed: FeedItem[];
  runStatus: string;
  savedAt: number;
};

function loadSnapshot(): SessionSnapshot | null {
  try {
    const raw = sessionStorage.getItem(SESSION_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionSnapshot;
    if (!parsed?.session?.sessionId || !Array.isArray(parsed.feed)) return null;
    if (Date.now() - (parsed.savedAt ?? 0) > SNAPSHOT_MAX_AGE_MS) {
      sessionStorage.removeItem(SESSION_SNAPSHOT_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Only hydrate when the snapshot matches the URL agent/project (or URL has none). */
function loadSnapshotForCurrentUrl(): SessionSnapshot | null {
  const snap = loadSnapshot();
  if (!snap) return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const urlAgent = params.get("agent");
    if (urlAgent && urlAgent !== snap.session.agentId) return null;
    const urlProject = params.get("project");
    if (urlProject && urlProject !== snap.session.project) return null;
  } catch {
    return snap;
  }
  return snap;
}

function saveSnapshot(session: Session, feed: FeedItem[], runStatus: string) {
  try {
    sessionStorage.setItem(
      SESSION_SNAPSHOT_KEY,
      JSON.stringify({
        session,
        feed,
        runStatus,
        savedAt: Date.now(),
      } satisfies SessionSnapshot),
    );
  } catch {
    // QuotaExceeded or private mode — soft sync still works without a snapshot.
  }
}

function clearSnapshot() {
  try {
    sessionStorage.removeItem(SESSION_SNAPSHOT_KEY);
  } catch {
    // ignore
  }
}

let itemCounter = 0;
function nextId() {
  return `item-${++itemCounter}`;
}

function statusFromSession(s: Pick<Session, "runStatus" | "runActive">): string {
  if (s.runActive) return "running";
  if (s.runStatus === "finished") return "idle";
  return String(s.runStatus);
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

/** No SSE bytes (including the 15s server heartbeat) within this long means
 * the connection is dead — most commonly a mobile tab that got backgrounded
 * mid-stream. Abort locally and reconcile with the server's real state
 * rather than leaving the composer locked forever. */
const STREAM_IDLE_TIMEOUT_MS = 45_000;

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

function applyWatchEvent(
  event: SseEvent,
  setFeed: Dispatch<SetStateAction<FeedItem[]>>,
  setSession: Dispatch<SetStateAction<Session | null>>,
  setRunStatus: Dispatch<SetStateAction<string>>,
  setError: Dispatch<SetStateAction<string | null>>,
) {
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
    if (event.runActive === true) {
      setRunStatus("running");
    } else if (event.runActive === false) {
      const status =
        event.runStatus === "finished" ? "idle" : (event.runStatus ?? "idle");
      setRunStatus(status);
    }
    return;
  }

  if (event.type === "done") {
    const status = event.status === "finished" ? "idle" : event.status;
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
    return;
  }

  if (event.type === "error") {
    setError(event.message);
    setRunStatus("error");
    setSession((prev) =>
      prev ? { ...prev, runStatus: "error", runActive: false } : prev,
    );
  }

  setFeed((items) => applyEvent(items, event));
}

export function useChatSession() {
  const restoredRef = useRef<SessionSnapshot | null | undefined>(undefined);
  if (restoredRef.current === undefined) {
    restoredRef.current =
      typeof window !== "undefined" ? loadSnapshotForCurrentUrl() : null;
  }
  const restored = restoredRef.current;

  const [session, setSession] = useState<Session | null>(
    () => restored?.session ?? null,
  );
  const [feed, setFeed] = useState<FeedItem[]>(() => restored?.feed ?? []);
  const [runStatus, setRunStatus] = useState<string>(
    () => restored?.runStatus ?? "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const epochRef = useRef(0);
  const feedRef = useRef<FeedItem[]>([]);

  useEffect(() => {
    feedRef.current = feed;
  }, [feed]);

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
    saveSnapshot(session, feed, runStatus);
  }, [session, feed, runStatus]);

  // After a cold restore from snapshot, revalidate quietly so Telegram/other
  // clients don't leave us looking at stale history — without blanking the UI.
  useEffect(() => {
    if (!restored?.session) return;
    const snap = restored.session;
    const epoch = epochRef.current;
    void (async () => {
      try {
        let s: Session;
        try {
          s = await getSession(snap.sessionId);
        } catch {
          s = await resumeSession(snap.agentId, snap.project, snap.model);
        }
        if (epoch !== epochRef.current) return;
        const history = await getAgentHistory(s.agentId, s.project).catch(
          () => null,
        );
        if (epoch !== epochRef.current) return;
        setSession(s);
        setRunStatus(statusFromSession(s));
        if (history?.items) setFeed(history.items);
      } catch {
        // Keep snapshot UI; user can still prompt or start a new session.
      }
    })();
  }, [restored]);

  useEffect(() => {
    if (!session?.sessionId) return;

    const sessionId = session.sessionId;
    const epoch = epochRef.current;
    const controller = new AbortController();
    const replay = feedRef.current.length === 0 ? "1" : "0";
    let active = true;

    void (async () => {
      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/events?replay=${replay}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          throw new Error(`Watch stream failed (${res.status})`);
        }

        for await (const event of readSseStream(res)) {
          if (!active || epoch !== epochRef.current) break;
          applyWatchEvent(
            event,
            setFeed,
            setSession,
            setRunStatus,
            setError,
          );
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Session watch disconnected:", err);
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [session?.sessionId]);

  const syncSession = useCallback((id: string) => {
    const epoch = epochRef.current;
    void getSession(id)
      .then((s) => {
        if (epoch !== epochRef.current) return;
        setSession((prev) => (prev?.sessionId === id ? s : prev));
        setRunStatus(statusFromSession(s));
      })
      .catch(() => undefined);
  }, []);

  // Keep polling even while running so a dropped watch stream cannot leave
  // the composer locked forever.
  useEffect(() => {
    if (!session?.sessionId) return;

    const id = session.sessionId;
    const ms = runStatus === "running" ? 2000 : 3000;
    const interval = window.setInterval(() => syncSession(id), ms);
    return () => window.clearInterval(interval);
  }, [session?.sessionId, runStatus, syncSession]);

  // Mobile browsers can suspend/kill background network activity; resync
  // immediately on return so status/composer state don't stay stale.
  useEffect(() => {
    if (!session?.sessionId) return;
    const id = session.sessionId;
    const onWake = () => {
      if (document.visibilityState === "visible") syncSession(id);
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("pageshow", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("pageshow", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [session?.sessionId, syncSession]);

  const startSession = useCallback(
    async (project: string, model: string) => {
      // Invalidate in-flight resume/watch so a URL auto-resume cannot
      // overwrite this freshly created session.
      epochRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      const epoch = epochRef.current;
      setError(null);
      setFeed([]);
      const s = await createSession(project, model);
      if (epoch !== epochRef.current) return s;
      setSession(s);
      setRunStatus(statusFromSession(s));
      return s;
    },
    [],
  );

  const resumeAgent = useCallback(
    async (agentId: string, project: string, model: string) => {
      const epoch = epochRef.current;
      setError(null);
      // Don't flash the loading banner when we already painted a snapshot/feed.
      setHistoryLoading(feedRef.current.length === 0);
      try {
        const [s, history] = await Promise.all([
          resumeSession(agentId, project, model),
          getAgentHistory(agentId, project).catch(() => ({
            items: [] as FeedItem[],
          })),
        ]);
        if (epoch !== epochRef.current) return null;
        setFeed(history.items);
        setSession(s);
        setRunStatus(statusFromSession(s));
        return s;
      } finally {
        if (epoch === epochRef.current) {
          setHistoryLoading(false);
        }
      }
    },
    [],
  );

  const clearSession = useCallback(() => {
    epochRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setSession(null);
    setFeed([]);
    setRunStatus("idle");
    setError(null);
    setHistoryLoading(false);
    localStorage.removeItem(SESSION_STORAGE_KEY);
    clearSnapshot();
  }, []);

  const sendPrompt = useCallback(
    async (
      prompt: string,
      source = "manual",
      sessionOverride?: Session,
      options: {
        includeDevLogs?: boolean;
        allowOverlap?: boolean;
        images?: Array<{ data: string; mimeType: string; name?: string }>;
      } = {},
    ) => {
      const active = sessionOverride ?? session;
      if (!active) {
        throw new Error("No active session");
      }

      const epoch = epochRef.current;
      setError(null);
      setRunStatus("running");

      // Overlapping sends keep the existing chat SSE alive so the original
      // run can still finish; a normal send supersedes the prior reader.
      if (!options.allowOverlap) {
        abortRef.current?.abort();
      }
      const controller = new AbortController();
      if (!options.allowOverlap) {
        abortRef.current = controller;
      }

      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      const clearIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
      };
      const armIdleTimer = () => {
        clearIdleTimer();
        idleTimer = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT_MS);
      };

      try {
        const res = await postChat(active.sessionId, prompt, {
          source: source === "manual" ? "manual" : "api",
          includeDevLogs: options.includeDevLogs,
          allowOverlap: options.allowOverlap,
          images: options.images,
          signal: controller.signal,
        });
        armIdleTimer();

        for await (const event of readSseStream(res, {
          onActivity: armIdleTimer,
        })) {
          if (epoch !== epochRef.current) return;
          if (event.type === "session") {
            setSession((prev) =>
              prev
                ? {
                    ...prev,
                    name: event.name ?? prev.name,
                    runStatus: event.runStatus ?? prev.runStatus,
                    runActive: event.runActive ?? prev.runActive,
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
                    lastActivityAt:
                      Date.parse(event.timestamp) || prev.lastActivityAt,
                  }
                : prev,
            );
          } else if (event.type === "error") {
            setError(event.message);
            setRunStatus("error");
          }
        }
        if (epoch !== epochRef.current) return;
        setRunStatus((prev) => (prev === "running" ? "idle" : prev));
      } catch (err) {
        if (epoch !== epochRef.current) {
          throw err;
        }
        if (isAbortError(err)) {
          // Locally aborted (idle stream or superseded request) — the
          // server-side run may still be in progress or may have already
          // finished. Reconcile instead of leaving state stuck on "running".
          syncSession(active.sessionId);
          return;
        }
        let message = err instanceof Error ? err.message : "Chat failed";
        if (
          (err instanceof ApiError && err.code === "SESSION_BUSY") ||
          /already has (?:an )?active run/i.test(message)
        ) {
          message =
            "Still working on the previous message — tap Stop, or wait for it to finish.";
        }
        setError(message);
        setFeed((items) => [
          ...items,
          { id: nextId(), kind: "error", message },
        ]);
        if (!options.allowOverlap) {
          setRunStatus("error");
          setSession((prev) =>
            prev ? { ...prev, runStatus: "error", runActive: false } : prev,
          );
        } else {
          syncSession(active.sessionId);
        }
        throw err instanceof Error ? err : new Error(message);
      } finally {
        clearIdleTimer();
      }
    },
    [session, syncSession],
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
