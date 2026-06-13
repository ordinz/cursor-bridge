import { useCallback, useEffect, useState } from "react";
import { deleteAgent as deleteAgentApi, getAgents } from "../lib/api";
import type { AgentInfo } from "../lib/types";

export function useAgentHistory(project: string | null) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!project) {
      setAgents([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getAgents(project);
      setAgents(data.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, [project]);

  const deleteAgent = useCallback(
    async (agentId: string) => {
      if (!project) return;
      setDeletingId(agentId);
      setError(null);
      try {
        await deleteAgentApi(agentId, project);
        setAgents((prev) => prev.filter((a) => a.agentId !== agentId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete agent");
        throw err;
      } finally {
        setDeletingId(null);
      }
    },
    [project],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { agents, loading, deletingId, error, refresh, deleteAgent };
}
