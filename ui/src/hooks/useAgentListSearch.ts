import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Client-filter a list; when the query matches nothing locally, kick a
 * one-shot deeper server search (provided by the caller).
 */
export function useAgentListSearch<T>(options: {
  agents: T[];
  query: string;
  match: (agent: T, query: string) => boolean;
  searchServer?: (query: string) => Promise<void>;
  searchingServer?: boolean;
}) {
  const { agents, query, match, searchServer, searchingServer = false } =
    options;
  const trimmed = query.trim();
  const searchedForRef = useRef<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    searchedForRef.current = null;
    setPending(false);
  }, [trimmed]);

  const filtered = useMemo(() => {
    if (!trimmed) return agents;
    return agents.filter((agent) => match(agent, trimmed));
  }, [agents, match, trimmed]);

  useEffect(() => {
    if (!trimmed || !searchServer) return;
    if (filtered.length > 0) return;
    if (searchedForRef.current === trimmed) return;

    let cancelled = false;
    searchedForRef.current = trimmed;
    setPending(true);
    void (async () => {
      try {
        await searchServer(trimmed);
      } finally {
        if (!cancelled) setPending(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [trimmed, filtered.length, searchServer]);

  const searchingDeeper =
    Boolean(trimmed) &&
    filtered.length === 0 &&
    (pending || searchingServer);

  return { filtered, searchingDeeper };
}
