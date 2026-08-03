/** Default Recent hub window before “Show more”. */
export const RECENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export function agentActivityAt(agent: {
  listActivityAt?: number;
  lastActivityAt?: number;
  lastModified?: number;
}): number {
  return Math.max(
    agent.listActivityAt || 0,
    agent.lastActivityAt || 0,
    agent.lastModified || 0,
  );
}

export function isWithinRecentWindow(
  agent: {
    listActivityAt?: number;
    lastActivityAt?: number;
    lastModified?: number;
  },
  now = Date.now(),
  windowMs = RECENT_WINDOW_MS,
): boolean {
  return now - agentActivityAt(agent) <= windowMs;
}

export function matchesAgentQuery(
  agent: {
    name?: string;
    summary?: string;
    agentId: string;
    project?: string;
    lastPrompt?: string | null;
    lastAssistantSnippet?: string | null;
  },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    agent.name,
    agent.summary,
    agent.agentId,
    agent.project,
    agent.lastPrompt,
    agent.lastAssistantSnippet,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return haystack.includes(q);
}
