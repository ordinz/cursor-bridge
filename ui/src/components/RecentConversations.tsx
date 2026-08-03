import { useCallback, useMemo, useState } from "react";
import { ArchiveIcon, ArchiveRestoreIcon, Trash2Icon } from "lucide-react";
import type { RecentAgent } from "../hooks/useRecentConversations";
import { useAgentListSearch } from "../hooks/useAgentListSearch";
import {
  agentActivityAt,
  isWithinRecentWindow,
  matchesAgentQuery,
} from "../lib/agent-list";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface RecentConversationsProps {
  agents: RecentAgent[];
  agentsLoading: boolean;
  busyId: string | null;
  activeAgentId?: string | null;
  error?: string | null;
  showArchived?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  className?: string;
  onShowArchivedChange?: (show: boolean) => void;
  onLoadMore?: () => Promise<void>;
  onResumeAgent: (agentId: string, project: string) => void;
  onArchiveAgent: (agentId: string, project: string) => void;
  onUnarchiveAgent: (agentId: string, project: string) => void;
  onDeleteAgent: (agentId: string, project: string) => void;
}

function formatRelative(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 45_000) return "just now";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000)
    return `${Math.max(1, Math.floor(diff / 3_600_000))}h ago`;
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function previewFor(agent: RecentAgent): string {
  const snippet = agent.lastAssistantSnippet?.trim();
  if (snippet) return snippet;
  const prompt = agent.lastPrompt?.trim();
  if (prompt) return prompt;
  const summary = agent.summary?.trim();
  if (summary) return summary;
  return "";
}

function statusLabel(agent: RecentAgent): string | null {
  if (agent.archived) return "Archived";
  if (agent.runActive) return "Running";
  if (agent.runStatus === "error") return "Error";
  if (agent.runStatus === "cancelled") return "Cancelled";
  if (agent.unread) return "Done";
  return null;
}

function StatusDot({
  agent,
  isActive,
}: {
  agent: RecentAgent;
  isActive: boolean;
}) {
  if (agent.runActive) {
    return (
      <span
        className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400"
        aria-hidden="true"
        title="Running"
      />
    );
  }
  if (agent.runStatus === "error") {
    return (
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500"
        aria-hidden="true"
        title="Error"
      />
    );
  }
  if (agent.unread) {
    return (
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-400"
        aria-hidden="true"
        title="Done · unread"
      />
    );
  }
  if (isActive) {
    return (
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-400/70"
        aria-hidden="true"
        title="Open"
      />
    );
  }
  return (
    <span
      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-zinc-700"
      aria-hidden="true"
    />
  );
}

function AgentArchiveButton({
  agent,
  busy,
  onArchive,
}: {
  agent: RecentAgent;
  busy: boolean;
  onArchive: () => void;
}) {
  const label = agent.name?.trim() || agent.agentId.slice(0, 16);

  return (
    <AlertDialog>
      <AlertDialogTrigger
        disabled={busy}
        render={
          <Button
            variant="ghost"
            size="icon"
            className="mt-2.5 size-11 shrink-0 text-zinc-500 opacity-100 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
            data-testid="recent-archive-button"
            data-agent-id={agent.agentId}
            aria-label={`Archive ${label}`}
            title="Archive agent"
          />
        }
      >
        {busy ? (
          <span className="text-sm">…</span>
        ) : (
          <ArchiveIcon className="size-4" />
        )}
      </AlertDialogTrigger>
      <AlertDialogContent size="sm" data-testid="recent-archive-dialog">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <ArchiveIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>Archive agent?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-foreground">“{label}”</span> (
            {agent.project}) moves out of History and Recent. Toggle “Show
            archived” to find it again, or reopen it to bring it back
            automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="recent-archive-cancel">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="recent-archive-confirm"
            onClick={onArchive}
          >
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AgentUnarchiveButton({
  agent,
  busy,
  onUnarchive,
}: {
  agent: RecentAgent;
  busy: boolean;
  onUnarchive: () => void;
}) {
  const label = agent.name?.trim() || agent.agentId.slice(0, 16);

  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={busy}
      className="mt-2.5 size-11 shrink-0 text-zinc-500 opacity-100 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
      data-testid="recent-unarchive-button"
      data-agent-id={agent.agentId}
      aria-label={`Unarchive ${label}`}
      title="Unarchive agent"
      onClick={onUnarchive}
    >
      {busy ? (
        <span className="text-sm">…</span>
      ) : (
        <ArchiveRestoreIcon className="size-4" />
      )}
    </Button>
  );
}

function AgentDeleteButton({
  agent,
  busy,
  onDelete,
}: {
  agent: RecentAgent;
  busy: boolean;
  onDelete: () => void;
}) {
  const label = agent.name?.trim() || agent.agentId.slice(0, 16);

  return (
    <AlertDialog>
      <AlertDialogTrigger
        disabled={busy}
        render={
          <Button
            variant="ghost"
            size="icon"
            className="mt-2.5 mr-1.5 size-11 shrink-0 text-zinc-500 opacity-100 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            data-testid="recent-delete-button"
            data-agent-id={agent.agentId}
            aria-label={`Delete ${label}`}
            title="Delete agent"
          />
        }
      >
        {busy ? (
          <span className="text-sm">…</span>
        ) : (
          <Trash2Icon className="size-4" />
        )}
      </AlertDialogTrigger>
      <AlertDialogContent size="sm" data-testid="recent-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete agent?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes{" "}
            <span className="font-medium text-foreground">“{label}”</span> (
            {agent.project}) and its conversation history. This cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="recent-delete-cancel">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            data-testid="recent-delete-confirm"
            onClick={onDelete}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function RecentConversations({
  agents,
  agentsLoading,
  busyId,
  activeAgentId = null,
  error = null,
  showArchived = false,
  loadingMore = false,
  hasMore = false,
  className = "",
  onShowArchivedChange,
  onLoadMore,
  onResumeAgent,
  onArchiveAgent,
  onUnarchiveAgent,
  onDeleteAgent,
}: RecentConversationsProps) {
  const [query, setQuery] = useState("");
  const [showOlder, setShowOlder] = useState(false);

  const match = useCallback(
    (agent: RecentAgent, q: string) => matchesAgentQuery(agent, q),
    [],
  );
  const loadMore = useCallback(async () => {
    await onLoadMore?.();
  }, [onLoadMore]);

  const { filtered, searchingDeeper } = useAgentListSearch({
    agents,
    query,
    match,
    hasMore: Boolean(onLoadMore) && hasMore,
    loadingMore,
    loadMore,
  });

  const { visible, olderCount } = useMemo(() => {
    if (showOlder || query.trim()) {
      return { visible: filtered, olderCount: 0 };
    }
    const recent: RecentAgent[] = [];
    let older = 0;
    for (const agent of filtered) {
      if (isWithinRecentWindow(agent)) recent.push(agent);
      else older += 1;
    }
    return { visible: recent, olderCount: older };
  }, [filtered, showOlder, query]);

  const canShowMore =
    !query.trim() && !showOlder && (olderCount > 0 || hasMore);

  const handleShowMore = () => {
    setShowOlder(true);
    if (olderCount === 0 && hasMore) void loadMore();
  };

  const runningCount = visible.filter((a) => a.runActive).length;
  const unreadCount = visible.filter((a) => a.unread && !a.runActive).length;
  const subtitle =
    runningCount > 0
      ? `${runningCount} running · tap to switch`
      : unreadCount > 0
        ? `${unreadCount} unread · tap to open`
        : showArchived
          ? "Including archived · tap to switch"
          : showOlder || query.trim()
            ? "Across all projects · tap to switch"
            : "Last 3 days · tap to switch";

  return (
    <aside
      className={`min-w-0 flex-1 flex-col overflow-hidden bg-zinc-950 ${className}`}
      data-component="RecentConversations"
      data-testid="recent-conversations"
      data-section="recent"
      aria-label="Recent conversations hub"
    >
      <div
        className="border-b border-zinc-800/80 px-4 py-3.5"
        data-section="recent-header"
        data-testid="recent-conversations__header"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[15px] font-semibold tracking-tight text-zinc-100">
            Recent
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <div
                className="rounded-full bg-emerald-950/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-400"
                data-testid="recent-conversations__unread-badge"
              >
                {unreadCount} new
              </div>
            )}
            {runningCount > 0 && (
              <div
                className="rounded-full bg-amber-950/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-400"
                data-testid="recent-conversations__running-badge"
              >
                {runningCount} live
              </div>
            )}
            {onShowArchivedChange && (
              <button
                type="button"
                onClick={() => onShowArchivedChange(!showArchived)}
                className={`shrink-0 text-[11px] font-medium transition-colors ${
                  showArchived
                    ? "text-zinc-300 hover:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
                data-testid="recent-show-archived"
                aria-pressed={showArchived}
              >
                {showArchived ? "Hide archived" : "Show archived"}
              </button>
            )}
          </div>
        </div>
        <div
          className="text-xs text-zinc-500"
          data-testid="recent-conversations__subtitle"
        >
          {subtitle}
        </div>
        <div className="mt-2.5">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter conversations…"
            style={{ fontSize: 16 }}
            className="h-9 w-full rounded-md border border-zinc-700/80 bg-zinc-900 px-2.5 text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
            data-testid="recent-search"
            aria-label="Filter recent conversations"
          />
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto overscroll-contain"
        data-section="recent-list"
        data-testid="recent-conversations__list"
      >
        {error && (
          <p
            className="border-b border-red-900/40 bg-red-950/20 px-4 py-2 text-xs text-red-300"
            data-testid="recent-conversations__error"
            role="alert"
          >
            {error}
          </p>
        )}
        {agentsLoading && agents.length === 0 && (
          <p
            className="px-4 py-3 text-xs text-zinc-500"
            data-testid="recent-conversations__loading"
          >
            Loading…
          </p>
        )}
        {!agentsLoading && !searchingDeeper && visible.length === 0 && (
          <p
            className="px-4 py-3 text-xs text-zinc-500"
            data-testid="recent-conversations__empty"
          >
            {query.trim()
              ? "No conversations match."
              : "No recent conversations."}
          </p>
        )}
        {searchingDeeper && (
          <p
            className="px-4 py-3 text-xs text-zinc-500"
            data-testid="recent-conversations__searching-deeper"
          >
            Searching older conversations…
          </p>
        )}
        <ul className="divide-y divide-zinc-800/60">
          {visible.map((agent) => {
            const isActive = activeAgentId === agent.agentId;
            const shortId = agent.agentId.slice(0, 12);
            const preview = previewFor(agent);
            const label = statusLabel(agent);
            const when = formatRelative(agentActivityAt(agent));
            const busy = busyId === agent.agentId;
            const archived = Boolean(agent.archived);
            const rowState = archived
              ? "archived"
              : agent.runActive
                ? "running"
                : agent.runStatus === "error"
                  ? "error"
                  : agent.unread
                    ? "unread"
                    : isActive
                      ? "active"
                      : "idle";

            return (
              <li
                key={`${agent.project}:${agent.agentId}`}
                className={`group flex items-stretch gap-0 border-l-2 ${
                  archived
                    ? "border-l-transparent opacity-60"
                    : agent.runActive
                      ? "border-l-amber-400 bg-amber-950/15"
                      : agent.runStatus === "error"
                        ? "border-l-red-500/80"
                        : agent.unread
                          ? "border-l-emerald-400/80 bg-emerald-950/10"
                          : isActive
                            ? "border-l-emerald-400/50 bg-zinc-800/70"
                            : "border-l-transparent"
                } ${!isActive && !agent.runActive && !agent.unread && !archived ? "active:bg-zinc-900" : ""}`}
                data-item="RecentConversationItem"
                data-testid="recent-conversation-item"
                data-agent-id={agent.agentId}
                data-project={agent.project}
                data-active={isActive || undefined}
                data-unread={agent.unread || undefined}
                data-archived={archived || undefined}
                data-state={rowState}
                data-run-active={agent.runActive || undefined}
              >
                <button
                  type="button"
                  onClick={() => onResumeAgent(agent.agentId, agent.project)}
                  disabled={busy}
                  aria-current={isActive ? "true" : undefined}
                  className="flex min-h-14 min-w-0 flex-1 gap-2.5 px-3 py-3 text-left disabled:opacity-50"
                  data-testid={`recent-resume-${shortId}`}
                >
                  <StatusDot agent={agent} isActive={isActive} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`min-w-0 flex-1 truncate text-[15px] ${
                          isActive || agent.runActive || agent.unread
                            ? "font-medium text-zinc-50"
                            : "text-zinc-100"
                        }`}
                      >
                        {agent.name || agent.agentId.slice(0, 16)}
                      </span>
                      {label && (
                        <span
                          className={`shrink-0 text-[10px] font-medium uppercase tracking-wide ${
                            archived
                              ? "text-zinc-500"
                              : agent.runActive
                                ? "text-amber-400"
                                : agent.runStatus === "error" ||
                                    agent.runStatus === "cancelled"
                                  ? "text-red-400"
                                  : "text-emerald-400"
                          }`}
                        >
                          {label}
                        </span>
                      )}
                    </div>
                    <div
                      className={`mt-0.5 truncate text-xs ${
                        isActive || agent.runActive || agent.unread
                          ? "text-zinc-400"
                          : "text-zinc-500"
                      }`}
                    >
                      <span className="text-zinc-400">{agent.project}</span>
                      {preview && (
                        <>
                          <span className="text-zinc-600"> · </span>
                          <span>{preview}</span>
                        </>
                      )}
                    </div>
                    <div
                      className={`mt-0.5 text-[10px] ${
                        isActive || agent.runActive || agent.unread
                          ? "text-zinc-500"
                          : "text-zinc-600"
                      }`}
                    >
                      {when}
                    </div>
                  </div>
                </button>
                {archived ? (
                  <AgentUnarchiveButton
                    agent={agent}
                    busy={busy}
                    onUnarchive={() =>
                      onUnarchiveAgent(agent.agentId, agent.project)
                    }
                  />
                ) : (
                  <AgentArchiveButton
                    agent={agent}
                    busy={busy}
                    onArchive={() =>
                      onArchiveAgent(agent.agentId, agent.project)
                    }
                  />
                )}
                <AgentDeleteButton
                  agent={agent}
                  busy={busy}
                  onDelete={() => onDeleteAgent(agent.agentId, agent.project)}
                />
              </li>
            );
          })}
        </ul>
        {canShowMore && (
          <div className="border-t border-zinc-800/60 px-4 py-3">
            <button
              type="button"
              onClick={handleShowMore}
              disabled={loadingMore}
              className="w-full rounded-md border border-zinc-700/80 bg-zinc-900 px-3 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-zinc-50 disabled:opacity-50"
              data-testid="recent-show-more"
            >
              {loadingMore
                ? "Loading…"
                : olderCount > 0
                  ? `Show more (${olderCount} older)`
                  : "Show more"}
            </button>
          </div>
        )}
        {showOlder && hasMore && !query.trim() && (
          <div className="border-t border-zinc-800/60 px-4 py-3">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="w-full rounded-md border border-zinc-700/80 bg-zinc-900 px-3 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-zinc-50 disabled:opacity-50"
              data-testid="recent-load-more"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
