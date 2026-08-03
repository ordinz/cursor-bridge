import { isBridgeNamingAgent } from "./agent-names.js";

/** Cap how many Agent.list pages a deep search will walk. */
export const SEARCH_DEEPER_MAX_PAGES = 12;

/** Page size used while walking Agent.list for search. */
export const SEARCH_PAGE_SIZE = 50;

/**
 * Match agent list metadata against a query (name, summary, id).
 * @param {{ name?: string | null, summary?: string | null, agentId?: string }} agent
 * @param {string} query
 */
export function matchesAgentQuery(agent, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return true;
  const haystack = [agent?.name, agent?.summary, agent?.agentId]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return haystack.includes(q);
}

/**
 * Walk Agent.list pages and return agents matching `query`.
 * @param {{
 *   list: (opts: object) => Promise<{ items?: object[], nextCursor?: string | null }>,
 *   cwd: string,
 *   query: string,
 *   includeArchived?: boolean,
 *   maxPages?: number,
 *   pageSize?: number,
 * }} opts
 */
export async function searchLocalAgents(opts) {
  const {
    list,
    cwd,
    query,
    includeArchived = false,
    maxPages = SEARCH_DEEPER_MAX_PAGES,
    pageSize = SEARCH_PAGE_SIZE,
  } = opts;

  const q = String(query || "").trim();
  if (!q) {
    return { agents: [], nextCursor: null, pagesSearched: 0, exhausted: true };
  }

  /** @type {Map<string, object>} */
  const byId = new Map();
  let cursor;
  let pagesSearched = 0;
  let exhausted = false;

  while (pagesSearched < maxPages) {
    const result = await list({
      runtime: "local",
      cwd,
      limit: pageSize,
      ...(cursor ? { cursor } : {}),
    });
    pagesSearched += 1;

    for (const agent of result.items || []) {
      if (!agent || isBridgeNamingAgent(agent)) continue;
      if (!includeArchived && agent.archived) continue;
      if (!matchesAgentQuery(agent, q)) continue;
      const id = agent.agentId;
      if (!id) continue;
      byId.set(id, agent);
    }

    if (!result.nextCursor) {
      exhausted = true;
      cursor = null;
      break;
    }
    cursor = result.nextCursor;
  }

  const agents = [...byId.values()].sort(
    (a, b) => (b.lastModified || 0) - (a.lastModified || 0),
  );

  return {
    agents,
    nextCursor: exhausted ? null : cursor || null,
    pagesSearched,
    exhausted,
  };
}
