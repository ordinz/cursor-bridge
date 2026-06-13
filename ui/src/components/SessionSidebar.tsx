import type { AgentInfo } from "../lib/types";

interface SessionSidebarProps {
  project: string;
  agents: AgentInfo[];
  agentsLoading: boolean;
  deletingId: string | null;
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

export function SessionSidebar({
  project,
  agents,
  agentsLoading,
  deletingId,
  className = "",
  onResumeAgent,
  onDeleteAgent,
}: SessionSidebarProps) {
  return (
    <aside
      className={`shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 ${className}`}
      data-testid="session-sidebar"
    >
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="text-sm font-medium text-zinc-300">Agent history</div>
        <div className="text-xs text-zinc-600">{project}</div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-2">
        {agentsLoading && (
          <p className="px-2 text-xs text-zinc-500">Loading…</p>
        )}
        {!agentsLoading && agents.length === 0 && (
          <p className="px-2 text-xs text-zinc-500">No prior agents.</p>
        )}
        {agents.map((agent) => (
          <div
            key={agent.agentId}
            className="group mb-1 flex items-start gap-1 rounded-md active:bg-zinc-900"
            data-testid="agent-history-item"
          >
            <button
              type="button"
              onClick={() => onResumeAgent(agent.agentId)}
              disabled={deletingId === agent.agentId}
              className="min-h-11 min-w-0 flex-1 px-2 py-2 text-left disabled:opacity-50"
            >
              <div className="truncate text-sm text-zinc-200">
                {agent.name || agent.agentId.slice(0, 16)}
              </div>
              <div className="truncate text-xs text-zinc-500">
                {agent.summary || agent.status}
              </div>
              <div className="text-[10px] text-zinc-600">
                {formatTime(agent.lastModified)}
              </div>
            </button>
            <button
              type="button"
              onClick={() => onDeleteAgent(agent.agentId)}
              disabled={deletingId === agent.agentId}
              className="mt-2 mr-1 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded text-lg text-zinc-500 opacity-100 active:bg-red-950 active:text-red-300 disabled:opacity-50 lg:opacity-0 lg:group-hover:opacity-100"
              data-testid="agent-delete-button"
              title="Delete agent"
              aria-label="Delete agent"
            >
              {deletingId === agent.agentId ? "…" : "×"}
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
