import { useCallback, useEffect, useState } from "react";
import { getProjects } from "../lib/api";
import type { Project } from "../lib/types";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [root, setRoot] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getProjects();
      setProjects(data.projects);
      setRoot(data.root);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { projects, root, loading, error, refresh };
}
