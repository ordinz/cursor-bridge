import { useEffect, useMemo, useRef, useState } from "react";
import { SEARCH_DEEPER_MAX_PAGES } from "../lib/agent-list";

/**
 * Client-filter a list; when the query matches nothing locally but the
 * server still has pages, keep loading until a match appears or pages run out.
 */
export function useAgentListSearch<T>(options: {
  agents: T[];
  query: string;
  match: (agent: T, query: string) => boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
}) {
  const { agents, query, match, hasMore, loadingMore, loadMore } = options;
  const trimmed = query.trim();
  const pagesTriedRef = useRef(0);
  const kickRef = useRef(false);
  const [, setPagesTried] = useState(0);

  useEffect(() => {
    pagesTriedRef.current = 0;
    kickRef.current = false;
    setPagesTried(0);
  }, [trimmed]);

  useEffect(() => {
    if (!loadingMore) kickRef.current = false;
  }, [loadingMore]);

  const filtered = useMemo(() => {
    if (!trimmed) return agents;
    return agents.filter((agent) => match(agent, trimmed));
  }, [agents, match, trimmed]);

  useEffect(() => {
    if (!trimmed) return;
    if (filtered.length > 0) return;
    if (!hasMore || loadingMore || kickRef.current) return;
    if (pagesTriedRef.current >= SEARCH_DEEPER_MAX_PAGES) return;

    kickRef.current = true;
    pagesTriedRef.current += 1;
    setPagesTried(pagesTriedRef.current);
    void loadMore();
  }, [trimmed, filtered.length, hasMore, loadingMore, loadMore]);

  const searchingDeeper =
    Boolean(trimmed) &&
    filtered.length === 0 &&
    (loadingMore ||
      kickRef.current ||
      (hasMore && pagesTriedRef.current < SEARCH_DEEPER_MAX_PAGES));

  return { filtered, searchingDeeper };
}
