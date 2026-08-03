import { Trash2Icon } from "lucide-react";
import type { AgentInfo } from "../lib/types";
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

interface SessionSidebarProps {
  project: string;
  agents: AgentInfo[];
  agentsLoading: boolean;
  deletingId: string | null;
  activeAgentId?: string | null;
  className?: string;
  onResumeAgent: (agentId: string) => void;
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

function AgentDeleteButton({
  agent,
  deleting,
  onDelete,
}: {
  agent: AgentInfo;
  deleting: boolean;
  onDelete: () => void;
}) {
  const label = agent.name?.trim() || agent.agentId.slice(0, 16);

  return (
    <AlertDialog>
      <AlertDialogTrigger
        disabled={deleting}
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
        {deleting ? (
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
  agents,
  agentsLoading,
  deletingId,
  activeAgentId = null,
  className = "",
  onResumeAgent,
  onDeleteAgent,
}: SessionSidebarProps) {
  return (
    <aside
      className={`shrink-0 flex-col border-zinc-800 bg-zinc-950 lg:border-r ${className}`}
      data-component="SessionSidebar"
      data-testid="session-sidebar"
      data-section="history"
    >
      <div
        className="hidden border-b border-zinc-800/80 px-4 py-3.5 lg:block"
        data-section="history-header"
        data-testid="session-sidebar__header"
      >
        <div className="text-[15px] font-semibold tracking-tight text-zinc-100 lg:text-sm lg:font-medium lg:text-zinc-300">
          History
        </div>
        <div
          className="text-xs text-zinc-500"
          data-testid="session-sidebar__project"
        >
          {project}
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto overscroll-contain"
        data-section="history-list"
        data-testid="session-sidebar__list"
      >
        {agentsLoading && (
          <p
            className="px-4 py-3 text-xs text-zinc-500"
            data-testid="session-sidebar__loading"
          >
            Loading…
          </p>
        )}
        {!agentsLoading && agents.length === 0 && (
          <p
            className="px-4 py-3 text-xs text-zinc-500"
            data-testid="session-sidebar__empty"
          >
            No prior agents.
          </p>
        )}
        <ul className="divide-y divide-zinc-800/60 lg:divide-y-0 lg:p-2">
          {agents.map((agent) => {
            const isActive = activeAgentId === agent.agentId;
            const shortId = agent.agentId.slice(0, 12);
            return (
              <li
                key={agent.agentId}
                className={`group flex items-start gap-1 ${
                  isActive
                    ? "bg-zinc-800/70 lg:rounded-md lg:border-l-2 lg:border-l-zinc-200"
                    : "active:bg-zinc-900 lg:rounded-md lg:border-l-2 lg:border-l-transparent"
                }`}
                data-item="AgentHistoryItem"
                data-testid="agent-history-item"
                data-agent-id={agent.agentId}
                data-active={isActive || undefined}
                data-state={isActive ? "active" : "idle"}
              >
                <button
                  type="button"
                  onClick={() => onResumeAgent(agent.agentId)}
                  disabled={deletingId === agent.agentId}
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
                <AgentDeleteButton
                  agent={agent}
                  deleting={deletingId === agent.agentId}
                  onDelete={() => onDeleteAgent(agent.agentId)}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
