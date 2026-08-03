import { useCallback, useEffect, useState } from "react";
import {
  archiveAgent as archiveAgentApi,
  deleteAgent as deleteAgentApi,
  getAgents,
  unarchiveAgent as unarchiveAgentApi,
} from "../lib/api";
import type { AgentInfo } from "../lib/types";

function mergeAgents(prev: AgentInfo[], next: AgentInfo[]): AgentInfo[] {
  const byId = new Map(prev.map((a) => [a.agentId, a]));
  for (const agent of next) {
    byId.set(agent.agentId, { ...byId.get(agent.agentId), ...agent });
  }
  return [...byId.values()].sort(
    (a, b) => (b.lastModified || 0) - (a.lastModified || 0),
  );
}

export function useAgentHistory(
  project: string | null,
  options: { includeArchived?: boolean } = {},
) {
  const includeArchived = options.includeArchived ?? false;
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!project) {
      setAgents([]);
      setNextCursor(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getAgents(project, { includeArchived });
      setAgents(
        includeArchived
          ? data.agents
          : data.agents.filter((a) => !a.archived),
      );
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, [project, includeArchived]);

  const loadMore = useCallback(async () => {
    if (!project || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const data = await getAgents(project, {
        includeArchived,
        cursor: nextCursor,
      });
      const page = includeArchived
        ? data.agents
        : data.agents.filter((a) => !a.archived);
      setAgents((prev) => mergeAgents(prev, page));
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load more agents",
      );
    } finally {
      setLoadingMore(false);
    }
  }, [project, nextCursor, loadingMore, includeArchived]);

  const removeLocal = useCallback((agentId: string) => {
    setAgents((prev) => prev.filter((a) => a.agentId !== agentId));
  }, []);

  const archiveAgent = useCallback(
    async (agentId: string) => {
      if (!project) return;
      setBusyId(agentId);
      setError(null);
      try {
        await archiveAgentApi(agentId, project);
        if (includeArchived) {
          setAgents((prev) =>
            prev.map((a) =>
              a.agentId === agentId ? { ...a, archived: true } : a,
            ),
          );
        } else {
          removeLocal(agentId);
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
    [project, removeLocal, includeArchived],
  );

  const unarchiveAgent = useCallback(
    async (agentId: string) => {
      if (!project) return;
      setBusyId(agentId);
      setError(null);
      try {
        await unarchiveAgentApi(agentId, project);
        if (includeArchived) {
          setAgents((prev) =>
            prev.map((a) =>
              a.agentId === agentId ? { ...a, archived: false } : a,
            ),
          );
        } else {
          removeLocal(agentId);
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
    [project, removeLocal, includeArchived],
  );

  const deleteAgent = useCallback(
    async (agentId: string) => {
      if (!project) return;
      setBusyId(agentId);
      setError(null);
      try {
        await deleteAgentApi(agentId, project);
        removeLocal(agentId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete agent");
        throw err;
      } finally {
        setBusyId(null);
      }
    },
    [project, removeLocal],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    agents,
    loading,
    loadingMore,
    hasMore: Boolean(nextCursor),
    loadMore,
    deletingId: busyId,
    busyId,
    error,
    refresh,
    archiveAgent,
    unarchiveAgent,
    deleteAgent,
  };
}
