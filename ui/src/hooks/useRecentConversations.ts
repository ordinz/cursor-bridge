import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  archiveAgent as archiveAgentApi,
  deleteAgent as deleteAgentApi,
  getAgents,
  getConversationReads,
  getSessions,
  markConversationRead as markConversationReadApi,
  unarchiveAgent as unarchiveAgentApi,
} from "../lib/api";
import type {
  AgentInfo,
  ConversationReadEntry,
  Project,
  Session,
} from "../lib/types";

export type RecentAgent = AgentInfo & {
  project: string;
  runActive: boolean;
  runStatus: string;
  lastPrompt: string | null;
  lastAssistantSnippet: string | null;
  lastActivityAt: number;
  /** Stable sort key — ignores streaming token churn. */
  listActivityAt: number;
  /** Finished (or errored) since last open. */
  unread: boolean;
  sessionId?: string;
};

const SESSION_POLL_LIVE_MS = 2_000;
const SESSION_POLL_IDLE_MS = 5_000;
const AGENTS_POLL_LIVE_MS = 30_000;

function agentKey(project: string, agentId: string) {
  return `${project}:${agentId}`;
}

function normalizeRunStatus(
  runActive: boolean,
  sessionStatus: string | undefined,
  agentStatus: string | undefined,
): string {
  if (runActive) return "running";
  const raw = String(sessionStatus ?? agentStatus ?? "idle");
  if (raw === "finished") return "idle";
  return raw;
}

function isUnread(
  entry: ConversationReadEntry | undefined,
  runActive: boolean,
): boolean {
  if (runActive || !entry) return false;
  return entry.lastCompletedAt > entry.lastReadAt;
}

function sortActivityAt(
  agent: Pick<RecentAgent, "listActivityAt" | "lastActivityAt" | "lastModified">,
  entry?: ConversationReadEntry,
) {
  return Math.max(
    agent.listActivityAt || 0,
    entry?.lastSortAt || 0,
    agent.lastModified || 0,
  );
}

function mergeAgentsWithSessions(
  agents: Array<AgentInfo & { project: string }>,
  sessions: Session[],
  reads: Record<string, ConversationReadEntry>,
): RecentAgent[] {
  const byKey = new Map<string, Session>();
  for (const session of sessions) {
    const key = agentKey(session.project, session.agentId);
    const prev = byKey.get(key);
    if (!prev || session.lastActivityAt > prev.lastActivityAt) {
      byKey.set(key, session);
    }
  }

  const merged: RecentAgent[] = agents.map((agent) => {
    const key = agentKey(agent.project, agent.agentId);
    const session = byKey.get(key);
    const entry = reads[key];
    const runActive =
      Boolean(session?.runActive) || agent.status === "running";
    const runStatus = normalizeRunStatus(
      runActive,
      session?.runStatus,
      agent.status,
    );
    const listActivityAt = Math.max(
      session?.listActivityAt || 0,
      entry?.lastSortAt || 0,
      agent.lastModified || 0,
    );

    return {
      ...agent,
      name: session?.name?.trim() || agent.name,
      runActive,
      runStatus,
      lastPrompt: session?.lastPrompt ?? null,
      lastAssistantSnippet: session?.lastAssistantSnippet ?? null,
      lastActivityAt: session?.lastActivityAt ?? agent.lastModified,
      listActivityAt,
      unread: isUnread(entry, runActive),
      sessionId: session?.sessionId,
    };
  });

  // Surface in-memory sessions that aren't in the Cursor agent list yet
  // (brand-new creates). Idle leftovers for archived agents must not
  // reappear here — archive filters them from Agent.list but open
  // sessions would otherwise resurrect the row in Recent.
  for (const session of sessions) {
    const key = agentKey(session.project, session.agentId);
    if (merged.some((a) => agentKey(a.project, a.agentId) === key)) continue;
    const entry = reads[key];
    const runActive = Boolean(session.runActive);
    if (!runActive) continue;
    merged.push({
      agentId: session.agentId,
      name: session.name?.trim() || "",
      summary: "",
      lastModified: session.lastActivityAt,
      status: "running",
      project: session.project,
      runActive,
      runStatus: normalizeRunStatus(runActive, session.runStatus, undefined),
      lastPrompt: session.lastPrompt,
      lastAssistantSnippet: session.lastAssistantSnippet,
      lastActivityAt: session.lastActivityAt,
      listActivityAt: Math.max(
        session.listActivityAt || 0,
        entry?.lastSortAt || 0,
        session.lastActivityAt || 0,
      ),
      unread: isUnread(entry, runActive),
      sessionId: session.sessionId,
    });
  }

  return merged.sort((a, b) => {
    const diff =
      sortActivityAt(b, reads[agentKey(b.project, b.agentId)]) -
      sortActivityAt(a, reads[agentKey(a.project, a.agentId)]);
    if (diff !== 0) return diff;
    return agentKey(a.project, a.agentId).localeCompare(
      agentKey(b.project, b.agentId),
    );
  });
}

/**
 * Keep existing row order during live polls so status/snippet updates
 * don't reshuffle the list. New keys insert at the top; removed keys drop out.
 */
function stabilizeOrder(
  prevOrder: string[],
  next: RecentAgent[],
): RecentAgent[] {
  const byKey = new Map(
    next.map((agent) => [agentKey(agent.project, agent.agentId), agent]),
  );
  const stable: RecentAgent[] = [];

  for (const key of prevOrder) {
    const agent = byKey.get(key);
    if (!agent) continue;
    stable.push(agent);
    byKey.delete(key);
  }

  const newcomers = [...byKey.values()].sort((a, b) => {
    const diff = b.listActivityAt - a.listActivityAt;
    if (diff !== 0) return diff;
    return agentKey(a.project, a.agentId).localeCompare(
      agentKey(b.project, b.agentId),
    );
  });

  return [...newcomers, ...stable];
}

function mergeProjectAgents(
  prev: Array<AgentInfo & { project: string }>,
  next: Array<AgentInfo & { project: string }>,
): Array<AgentInfo & { project: string }> {
  const byKey = new Map(
    prev.map((a) => [agentKey(a.project, a.agentId), a]),
  );
  for (const agent of next) {
    const key = agentKey(agent.project, agent.agentId);
    byKey.set(key, { ...byKey.get(key), ...agent });
  }
  return [...byKey.values()];
}

export function useRecentConversations(
  projects: Project[],
  options: { live?: boolean; includeArchived?: boolean } = {},
) {
  const live = options.live ?? false;
  const includeArchived = options.includeArchived ?? false;
  const [agentsRaw, setAgentsRaw] = useState<
    Array<AgentInfo & { project: string }>
  >([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [reads, setReads] = useState<Record<string, ConversationReadEntry>>(
    {},
  );
  const [cursors, setCursors] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const loadedMoreRef = useRef(false);
  const cursorsRef = useRef(cursors);
  cursorsRef.current = cursors;
  const orderRef = useRef<string[]>([]);
  const liveRef = useRef(live);
  liveRef.current = live;

  const projectIds = projects
    .filter((p) => p.enabled !== false)
    .map((p) => p.id)
    .join("\0");

  const refreshAgents = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      const ids = projectIds ? projectIds.split("\0") : [];
      if (!ids.length) {
        setAgentsRaw([]);
        setCursors({});
        loadedMoreRef.current = false;
        return;
      }

      // Don't wipe deeper pages while the user is searching / showing more.
      if (opts.silent && loadedMoreRef.current) return;

      const silent = opts.silent && hasLoadedRef.current;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const batches = await Promise.all(
          ids.map(async (project) => {
            try {
              const data = await getAgents(project, { includeArchived });
              return {
                project,
                agents: data.agents
                  .map(
                    (agent): AgentInfo & { project: string } => ({
                      ...agent,
                      project,
                    }),
                  )
                  .filter((agent) => includeArchived || !agent.archived),
                nextCursor: data.nextCursor ?? null,
              };
            } catch {
              return {
                project,
                agents: [] as Array<AgentInfo & { project: string }>,
                nextCursor: null as string | null,
              };
            }
          }),
        );

        setAgentsRaw(batches.flatMap((b) => b.agents));
        setCursors(
          Object.fromEntries(batches.map((b) => [b.project, b.nextCursor])),
        );
        loadedMoreRef.current = false;
        hasLoadedRef.current = true;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load recent chats",
        );
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [projectIds, includeArchived],
  );

  const loadMore = useCallback(async () => {
    const ids = projectIds ? projectIds.split("\0") : [];
    const pending = ids.filter((id) => cursorsRef.current[id]);
    if (!pending.length || loadingMore) return;

    setLoadingMore(true);
    setError(null);
    try {
      const batches = await Promise.all(
        pending.map(async (project) => {
          const cursor = cursorsRef.current[project];
          if (!cursor) {
            return {
              project,
              agents: [] as Array<AgentInfo & { project: string }>,
              nextCursor: null as string | null,
            };
          }
          try {
            const data = await getAgents(project, {
              includeArchived,
              cursor,
            });
            return {
              project,
              agents: data.agents
                .map(
                  (agent): AgentInfo & { project: string } => ({
                    ...agent,
                    project,
                  }),
                )
                .filter((agent) => includeArchived || !agent.archived),
              nextCursor: data.nextCursor ?? null,
            };
          } catch {
            return {
              project,
              agents: [] as Array<AgentInfo & { project: string }>,
              nextCursor: null as string | null,
            };
          }
        }),
      );

      setAgentsRaw((prev) =>
        mergeProjectAgents(
          prev,
          batches.flatMap((b) => b.agents),
        ),
      );
      setCursors((prev) => {
        const next = { ...prev };
        for (const batch of batches) {
          next[batch.project] = batch.nextCursor;
        }
        return next;
      });
      loadedMoreRef.current = true;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load more chats",
      );
    } finally {
      setLoadingMore(false);
    }
  }, [projectIds, includeArchived, loadingMore]);

  const [searchingServer, setSearchingServer] = useState(false);

  const searchServer = useCallback(
    async (q: string) => {
      const ids = projectIds ? projectIds.split("\0") : [];
      const needle = q.trim();
      if (!ids.length || !needle) return;

      setSearchingServer(true);
      setError(null);
      try {
        const batches = await Promise.all(
          ids.map(async (project) => {
            try {
              const data = await getAgents(project, {
                includeArchived,
                q: needle,
              });
              return data.agents
                .map(
                  (agent): AgentInfo & { project: string } => ({
                    ...agent,
                    project,
                  }),
                )
                .filter((agent) => includeArchived || !agent.archived);
            } catch {
              return [] as Array<AgentInfo & { project: string }>;
            }
          }),
        );

        setAgentsRaw((prev) =>
          mergeProjectAgents(
            prev,
            batches.flat(),
          ),
        );
        loadedMoreRef.current = true;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to search chats",
        );
      } finally {
        setSearchingServer(false);
      }
    },
    [projectIds, includeArchived],
  );

  const refreshSessions = useCallback(async () => {
    try {
      const data = await getSessions();
      setSessions(data.sessions);
    } catch {
      // Keep last known live overlay if sessions briefly fail.
    }
  }, []);

  const refreshReads = useCallback(async () => {
    try {
      const data = await getConversationReads();
      setReads(data.reads ?? {});
    } catch {
      // Keep last known read state if the store briefly fails.
    }
  }, []);

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      // Full refresh re-sorts from activity (drop sticky order).
      orderRef.current = [];
      await Promise.all([
        refreshAgents(opts),
        refreshSessions(),
        refreshReads(),
      ]);
    },
    [refreshAgents, refreshSessions, refreshReads],
  );

  const markRead = useCallback(async (agentId: string, project: string) => {
    const key = agentKey(project, agentId);
    const now = Date.now();
    setReads((prev) => {
      const cur = prev[key] ?? {
        lastReadAt: 0,
        lastCompletedAt: 0,
        lastSortAt: 0,
      };
      if (cur.lastReadAt >= cur.lastCompletedAt && cur.lastReadAt > 0) {
        return prev;
      }
      return {
        ...prev,
        [key]: {
          ...cur,
          lastReadAt: Math.max(cur.lastReadAt, now, cur.lastCompletedAt),
        },
      };
    });
    try {
      const data = await markConversationReadApi(project, agentId);
      setReads((prev) => ({ ...prev, [key]: data.entry }));
    } catch {
      // Optimistic local mark still applies until next successful poll.
    }
  }, []);

  const removeLocal = useCallback((agentId: string, project: string) => {
    const key = agentKey(project, agentId);
    setAgentsRaw((prev) =>
      prev.filter((a) => !(a.agentId === agentId && a.project === project)),
    );
    setSessions((prev) =>
      prev.filter((s) => !(s.agentId === agentId && s.project === project)),
    );
    setReads((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    orderRef.current = orderRef.current.filter((k) => k !== key);
  }, []);

  const archiveAgent = useCallback(
    async (agentId: string, project: string) => {
      setBusyId(agentId);
      setError(null);
      try {
        await archiveAgentApi(agentId, project);
        if (includeArchived) {
          setAgentsRaw((prev) =>
            prev.map((a) =>
              a.agentId === agentId && a.project === project
                ? { ...a, archived: true }
                : a,
            ),
          );
          setSessions((prev) =>
            prev.filter(
              (s) => !(s.agentId === agentId && s.project === project),
            ),
          );
        } else {
          removeLocal(agentId, project);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to archive agent",
        );
        throw err;
      } finally {
        setBusyId(null);
      }
    },
    [removeLocal, includeArchived],
  );

  const unarchiveAgent = useCallback(
    async (agentId: string, project: string) => {
      setBusyId(agentId);
      setError(null);
      try {
        await unarchiveAgentApi(agentId, project);
        if (includeArchived) {
          setAgentsRaw((prev) =>
            prev.map((a) =>
              a.agentId === agentId && a.project === project
                ? { ...a, archived: false }
                : a,
            ),
          );
        } else {
          removeLocal(agentId, project);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to unarchive agent",
        );
        throw err;
      } finally {
        setBusyId(null);
      }
    },
    [removeLocal, includeArchived],
  );

  const deleteAgent = useCallback(
    async (agentId: string, project: string) => {
      setBusyId(agentId);
      setError(null);
      try {
        await deleteAgentApi(agentId, project);
        removeLocal(agentId, project);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete agent");
        throw err;
      } finally {
        setBusyId(null);
      }
    },
    [removeLocal],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live session + read overlay — cheap polls for run/unread status.
  useEffect(() => {
    void refreshSessions();
    void refreshReads();
    const ms = live ? SESSION_POLL_LIVE_MS : SESSION_POLL_IDLE_MS;
    const id = window.setInterval(() => {
      void refreshSessions();
      void refreshReads();
    }, ms);
    return () => window.clearInterval(id);
  }, [live, refreshSessions, refreshReads]);

  // While the hub is open, periodically refresh Cursor agent metadata too.
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      void refreshAgents({ silent: true });
    }, AGENTS_POLL_LIVE_MS);
    return () => window.clearInterval(id);
  }, [live, refreshAgents]);

  // Leaving the Recent tab clears sticky order so the next open re-sorts once.
  useEffect(() => {
    if (!live) orderRef.current = [];
  }, [live]);

  const agents = useMemo(() => {
    const merged = mergeAgentsWithSessions(agentsRaw, sessions, reads);
    if (!liveRef.current || orderRef.current.length === 0) {
      orderRef.current = merged.map((a) => agentKey(a.project, a.agentId));
      return merged;
    }
    const stable = stabilizeOrder(orderRef.current, merged);
    orderRef.current = stable.map((a) => agentKey(a.project, a.agentId));
    return stable;
  }, [agentsRaw, sessions, reads]);

  const runningCount = useMemo(
    () => agents.filter((a) => a.runActive).length,
    [agents],
  );

  const unreadCount = useMemo(
    () => agents.filter((a) => a.unread && !a.runActive).length,
    [agents],
  );

  const hasMore = useMemo(
    () => Object.values(cursors).some((c) => Boolean(c)),
    [cursors],
  );

  return {
    agents,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    searchingServer,
    searchServer,
    deletingId: busyId,
    busyId,
    error,
    runningCount,
    unreadCount,
    refresh,
    markRead,
    archiveAgent,
    unarchiveAgent,
    deleteAgent,
  };
}
