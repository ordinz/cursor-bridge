import { useCallback, useState } from "react";
import { ArchiveIcon, ArchiveRestoreIcon, Trash2Icon } from "lucide-react";
import type { AgentInfo, Project } from "../lib/types";
import { matchesAgentQuery } from "../lib/agent-list";
import { useAgentListSearch } from "../hooks/useAgentListSearch";
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
import { ProjectSelect } from "./ProjectSelect";

interface SessionSidebarProps {
  project: string;
  projects: Project[];
  agents: AgentInfo[];
  agentsLoading: boolean;
  busyId: string | null;
  activeAgentId?: string | null;
  showArchived?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  className?: string;
  onProjectChange: (project: string) => void;
  onShowArchivedChange?: (show: boolean) => void;
  onLoadMore?: () => Promise<void>;
  onResumeAgent: (agentId: string) => void;
  onArchiveAgent: (agentId: string) => void;
  onUnarchiveAgent: (agentId: string) => void;
  onDeleteAgent: (agentId: string) => void;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AgentArchiveButton({
  agent,
  busy,
  onArchive,
}: {
  agent: AgentInfo;
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
            className="mt-2 size-11 shrink-0 text-zinc-500 opacity-100 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50 lg:size-8 lg:opacity-0 lg:group-hover:opacity-100"
            data-testid="agent-archive-button"
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
      <AlertDialogContent size="sm" data-testid="agent-archive-dialog">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <ArchiveIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>Archive agent?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-foreground">“{label}”</span>{" "}
            moves out of History and Recent. Toggle “Show archived” to find it
            again, or reopen it to bring it back automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="agent-archive-cancel">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="agent-archive-confirm"
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
  agent: AgentInfo;
  busy: boolean;
  onUnarchive: () => void;
}) {
  const label = agent.name?.trim() || agent.agentId.slice(0, 16);

  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={busy}
      className="mt-2 size-11 shrink-0 text-zinc-500 opacity-100 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50 lg:size-8 lg:opacity-0 lg:group-hover:opacity-100"
      data-testid="agent-unarchive-button"
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
  agent: AgentInfo;
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
            className="mt-2 mr-2 size-11 shrink-0 text-zinc-500 opacity-100 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 lg:size-8 lg:opacity-0 lg:group-hover:opacity-100"
            data-testid="agent-delete-button"
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
      <AlertDialogContent size="sm" data-testid="agent-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete agent?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes{" "}
            <span className="font-medium text-foreground">“{label}”</span> and
            its conversation history. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="agent-delete-cancel">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            data-testid="agent-delete-confirm"
            onClick={onDelete}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SessionSidebar({
  project,
  projects,
  agents,
  agentsLoading,
  busyId,
  activeAgentId = null,
  showArchived = false,
  loadingMore = false,
  hasMore = false,
  className = "",
  onProjectChange,
  onShowArchivedChange,
  onLoadMore,
  onResumeAgent,
  onArchiveAgent,
  onUnarchiveAgent,
  onDeleteAgent,
}: SessionSidebarProps) {
  const [query, setQuery] = useState("");
  const match = useCallback(
    (agent: AgentInfo, q: string) => matchesAgentQuery(agent, q),
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

  return (
    <aside
      className={`shrink-0 flex-col border-zinc-800 bg-zinc-950 lg:border-r ${className}`}
      data-component="SessionSidebar"
      data-testid="session-sidebar"
      data-section="history"
    >
      <div
        className="border-b border-zinc-800/80 px-4 py-3.5"
        data-section="history-header"
        data-testid="session-sidebar__header"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[15px] font-semibold tracking-tight text-zinc-100 lg:text-sm lg:font-medium lg:text-zinc-300">
            History
          </div>
          {onShowArchivedChange && (
            <button
              type="button"
              onClick={() => onShowArchivedChange(!showArchived)}
              className={`shrink-0 text-[11px] font-medium transition-colors ${
                showArchived
                  ? "text-zinc-300 hover:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              data-testid="history-show-archived"
              aria-pressed={showArchived}
            >
              {showArchived ? "Hide archived" : "Show archived"}
            </button>
          )}
        </div>
        <div
          className="mt-1 min-w-0"
          data-testid="session-sidebar__project"
        >
          <ProjectSelect
            project={project}
            projects={projects}
            onProjectChange={onProjectChange}
            side="bottom"
          />
        </div>
        <div className="mt-2.5">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter history…"
            style={{ fontSize: 16 }}
            className="h-9 w-full rounded-md border border-zinc-700/80 bg-zinc-900 px-2.5 text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
            data-testid="history-search"
            aria-label="Filter history"
          />
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto overscroll-contain"
        data-section="history-list"
        data-testid="session-sidebar__list"
      >
        {agentsLoading && agents.length === 0 && (
          <p
            className="px-4 py-3 text-xs text-zinc-500"
            data-testid="session-sidebar__loading"
          >
            Loading…
          </p>
        )}
        {!agentsLoading && !searchingDeeper && filtered.length === 0 && (
          <p
            className="px-4 py-3 text-xs text-zinc-500"
            data-testid="session-sidebar__empty"
          >
            {query.trim()
              ? "No agents match."
              : showArchived
                ? "No agents."
                : "No prior agents."}
          </p>
        )}
        {searchingDeeper && (
          <p
            className="px-4 py-3 text-xs text-zinc-500"
            data-testid="session-sidebar__searching-deeper"
          >
            Searching older agents…
          </p>
        )}
        <ul className="divide-y divide-zinc-800/60 lg:divide-y-0 lg:p-2">
          {filtered.map((agent) => {
            const isActive = activeAgentId === agent.agentId;
            const shortId = agent.agentId.slice(0, 12);
            const busy = busyId === agent.agentId;
            const archived = Boolean(agent.archived);
            return (
              <li
                key={agent.agentId}
                className={`group flex items-start gap-0.5 ${
                  archived ? "opacity-60" : ""
                } ${
                  isActive
                    ? "bg-zinc-800/70 lg:rounded-md lg:border-l-2 lg:border-l-zinc-200"
                    : "active:bg-zinc-900 lg:rounded-md lg:border-l-2 lg:border-l-transparent"
                }`}
                data-item="AgentHistoryItem"
                data-testid="agent-history-item"
                data-agent-id={agent.agentId}
                data-active={isActive || undefined}
                data-archived={archived || undefined}
                data-state={isActive ? "active" : "idle"}
              >
                <button
                  type="button"
                  onClick={() => onResumeAgent(agent.agentId)}
                  disabled={busy}
                  aria-current={isActive ? "true" : undefined}
                  className="min-h-14 min-w-0 flex-1 px-4 py-3 text-left disabled:opacity-50 lg:min-h-11 lg:px-2 lg:py-2"
                  data-testid={`agent-history-resume-${shortId}`}
                >
                  <div className="flex items-center gap-1.5 truncate text-[15px] text-zinc-100 lg:text-sm lg:text-zinc-200">
                    {isActive && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`truncate ${isActive ? "font-medium text-zinc-50" : ""}`}
                    >
                      {agent.name || agent.agentId.slice(0, 16)}
                    </span>
                    {archived && (
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                        Archived
                      </span>
                    )}
                  </div>
                  <div
                    className={`truncate text-xs ${isActive ? "text-zinc-400" : "text-zinc-500"}`}
                  >
                    {agent.summary || agent.status}
                  </div>
                  <div
                    className={`text-[10px] ${isActive ? "text-zinc-500" : "text-zinc-600"}`}
                  >
                    {formatTime(agent.lastModified)}
                  </div>
                </button>
                {archived ? (
                  <AgentUnarchiveButton
                    agent={agent}
                    busy={busy}
                    onUnarchive={() => onUnarchiveAgent(agent.agentId)}
                  />
                ) : (
                  <AgentArchiveButton
                    agent={agent}
                    busy={busy}
                    onArchive={() => onArchiveAgent(agent.agentId)}
                  />
                )}
                <AgentDeleteButton
                  agent={agent}
                  busy={busy}
                  onDelete={() => onDeleteAgent(agent.agentId)}
                />
              </li>
            );
          })}
        </ul>
        {!query.trim() && hasMore && (
          <div className="border-t border-zinc-800/60 px-4 py-3 lg:border-t-0 lg:px-2 lg:pb-2">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="w-full rounded-md border border-zinc-700/80 bg-zinc-900 px-3 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-zinc-50 disabled:opacity-50 lg:py-2 lg:text-xs"
              data-testid="history-load-more"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
