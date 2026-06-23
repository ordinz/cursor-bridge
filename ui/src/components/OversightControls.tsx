import type { Model, Project, Session } from "../lib/types";
import { TelegramSend } from "./TelegramSend";

const REMOTE_HEALTH_URL = "https://cursor-mcp-bridge.kairose.com/health";

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

interface OversightControlsProps {
  session: Session | null;
  project: string;
  projects: Project[];
  models: Model[];
  model: string;
  modelsLoading: boolean;
  runStatus: string;
  onProjectChange: (project: string) => void;
  onModelChange: (model: string) => void;
  onNewSession: () => void;
  onStop: () => void;
}

export function OversightControls({
  session,
  project,
  projects,
  models,
  model,
  modelsLoading,
  runStatus,
  onProjectChange,
  onModelChange,
  onNewSession,
  onStop,
}: OversightControlsProps) {
  const running = runStatus === "running";

  return (
    <header
      className="shrink-0 border-b border-zinc-800 bg-zinc-950 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-4"
      data-testid="oversight-controls"
    >
      <div className="flex items-center gap-2">
        <h1 className="text-sm font-semibold text-zinc-200">cursor-bridge</h1>
        <span className="hidden text-xs text-zinc-600 sm:inline">
          agent console
        </span>
        {running && (
          <span className="ml-1 rounded bg-amber-950/60 px-1.5 py-0.5 text-[10px] uppercase text-amber-400 lg:hidden">
            running
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <TelegramSend />
          <a
            href={REMOTE_HEALTH_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center justify-center rounded-md border border-zinc-700 px-3 py-2 text-zinc-300 active:bg-zinc-900"
            aria-label="Open remote health check"
            data-testid="remote-health-link"
          >
            <ExternalLinkIcon className="h-4 w-4" />
          </a>
          {running && (
            <button
              type="button"
              onClick={onStop}
              className="min-h-11 rounded-md bg-red-900/60 px-3 py-2 text-sm font-medium text-red-200 active:bg-red-900"
              data-testid="stop-button"
            >
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={onNewSession}
            className="min-h-11 rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 active:bg-zinc-900"
            data-testid="new-session-button"
          >
            New
          </button>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <select
          value={project}
          onChange={(e) => onProjectChange(e.target.value)}
          className="min-h-11 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2 text-base text-zinc-200 sm:text-sm"
          data-testid="project-select"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={modelsLoading || models.length === 0}
          className="min-h-11 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2 text-base text-zinc-200 disabled:opacity-50 sm:text-sm"
          data-testid="model-select"
          title={
            session
              ? "Applies to new sessions; active session keeps its model"
              : "Model for new sessions"
          }
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName || m.id}
            </option>
          ))}
        </select>
      </div>

      {session && (
        <div className="mt-2 truncate text-xs text-zinc-600">
          {session.name ?? session.sessionId.slice(0, 8)}… · {session.model} ·{" "}
          <span
            className={
              runStatus === "running"
                ? "text-amber-400"
                : runStatus === "error"
                  ? "text-red-400"
                  : "text-zinc-500"
            }
          >
            {runStatus}
          </span>
        </div>
      )}
    </header>
  );
}
