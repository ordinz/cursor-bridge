import type { FeedItem } from "./types";

const INDEX_KEY = "cursor-bridge-conversation-cache-index-v1";
const ENTRY_PREFIX = "cursor-bridge-conversation-cache-v1:";

/** Keep enough recent chats for fast switching without blowing localStorage. */
const MAX_CONVERSATIONS = 30;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Truncate large tool payloads so streaming chats stay under quota. */
const MAX_TOOL_FIELD_CHARS = 4_000;

export type ConversationCacheEntry = {
  agentId: string;
  project: string;
  sessionId?: string;
  feed: FeedItem[];
  runStatus?: string;
  updatedAt: number;
};

type IndexEntry = { key: string; updatedAt: number };

function entryKey(project: string, agentId: string): string {
  return `${ENTRY_PREFIX}${project}:${agentId}`;
}

function loadIndex(): IndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is IndexEntry =>
        !!e &&
        typeof e === "object" &&
        typeof (e as IndexEntry).key === "string" &&
        typeof (e as IndexEntry).updatedAt === "number",
    );
  } catch {
    return [];
  }
}

function saveIndex(index: IndexEntry[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

function isFeedItem(item: unknown): item is FeedItem {
  if (!item || typeof item !== "object") return false;
  const kind = (item as { kind?: unknown }).kind;
  return (
    kind === "user" ||
    kind === "assistant" ||
    kind === "tool" ||
    kind === "status" ||
    kind === "error"
  );
}

function truncateUnknown(value: unknown, maxChars: number): unknown {
  if (typeof value === "string") {
    return value.length > maxChars
      ? `${value.slice(0, maxChars)}…`
      : value;
  }
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  try {
    const raw = JSON.stringify(value);
    if (raw.length <= maxChars) return value;
    return `${raw.slice(0, maxChars)}…`;
  } catch {
    return undefined;
  }
}

/** Drop bulky tool args/results so localStorage writes stay reliable. */
export function slimFeedForCache(feed: FeedItem[]): FeedItem[] {
  return feed.map((item) => {
    if (item.kind !== "tool") return item;
    return {
      ...item,
      args:
        item.args === undefined
          ? undefined
          : truncateUnknown(item.args, MAX_TOOL_FIELD_CHARS),
      result:
        item.result === undefined
          ? undefined
          : truncateUnknown(item.result, MAX_TOOL_FIELD_CHARS),
    };
  });
}

function evictExpired(index: IndexEntry[], now: number): IndexEntry[] {
  const kept: IndexEntry[] = [];
  for (const entry of index) {
    if (now - entry.updatedAt > MAX_AGE_MS) {
      try {
        localStorage.removeItem(entry.key);
      } catch {
        // ignore
      }
      continue;
    }
    kept.push(entry);
  }
  return kept;
}

function evictOldest(index: IndexEntry[]): IndexEntry[] {
  if (index.length === 0) return index;
  const sorted = [...index].sort((a, b) => a.updatedAt - b.updatedAt);
  const victim = sorted[0];
  try {
    localStorage.removeItem(victim.key);
  } catch {
    // ignore
  }
  return index.filter((e) => e.key !== victim.key);
}

function writeEntry(key: string, entry: ConversationCacheEntry, index: IndexEntry[]) {
  const now = Date.now();
  let nextIndex = evictExpired(index, now).filter((e) => e.key !== key);
  nextIndex.push({ key, updatedAt: entry.updatedAt });
  nextIndex.sort((a, b) => b.updatedAt - a.updatedAt);
  while (nextIndex.length > MAX_CONVERSATIONS) {
    nextIndex = evictOldest(nextIndex);
  }

  const payloads: ConversationCacheEntry[] = [
    entry,
    { ...entry, feed: slimFeedForCache(entry.feed) },
    {
      ...entry,
      feed: slimFeedForCache(entry.feed).map((item) =>
        item.kind === "tool"
          ? { ...item, args: undefined, result: undefined }
          : item,
      ),
    },
  ];

  for (const payload of payloads) {
    try {
      localStorage.setItem(key, JSON.stringify(payload));
      saveIndex(nextIndex);
      return true;
    } catch {
      // try slimmer payload / eviction below
    }
  }

  // Still failing — drop oldest chats and retry the slimmest payload.
  let retryIndex = nextIndex;
  const slim = payloads[payloads.length - 1];
  for (let i = 0; i < MAX_CONVERSATIONS && retryIndex.length > 0; i++) {
    retryIndex = evictOldest(retryIndex);
    try {
      localStorage.setItem(key, JSON.stringify(slim));
      const withSelf = retryIndex.filter((e) => e.key !== key);
      withSelf.push({ key, updatedAt: slim.updatedAt });
      saveIndex(withSelf);
      return true;
    } catch {
      // keep evicting
    }
  }
  return false;
}

export function loadConversationCache(
  project: string,
  agentId: string,
): ConversationCacheEntry | null {
  if (!project || !agentId) return null;
  try {
    const raw = localStorage.getItem(entryKey(project, agentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConversationCacheEntry;
    if (
      !parsed ||
      parsed.agentId !== agentId ||
      parsed.project !== project ||
      !Array.isArray(parsed.feed) ||
      !parsed.feed.every(isFeedItem)
    ) {
      return null;
    }
    if (Date.now() - (parsed.updatedAt ?? 0) > MAX_AGE_MS) {
      removeConversationCache(project, agentId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveConversationCache(
  project: string,
  agentId: string,
  data: {
    feed: FeedItem[];
    sessionId?: string;
    runStatus?: string;
  },
): boolean {
  if (!project || !agentId) return false;
  if (!Array.isArray(data.feed) || data.feed.length === 0) return false;

  const key = entryKey(project, agentId);
  const entry: ConversationCacheEntry = {
    agentId,
    project,
    sessionId: data.sessionId,
    feed: data.feed,
    runStatus: data.runStatus,
    updatedAt: Date.now(),
  };

  try {
    return writeEntry(key, entry, loadIndex());
  } catch {
    return false;
  }
}

export function removeConversationCache(project: string, agentId: string) {
  const key = entryKey(project, agentId);
  try {
    localStorage.removeItem(key);
    saveIndex(loadIndex().filter((e) => e.key !== key));
  } catch {
    // ignore
  }
}
