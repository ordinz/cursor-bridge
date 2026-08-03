import type { Model, Project, Session } from "../lib/types";
import { TelegramSend } from "./TelegramSend";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

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

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M21.8 4.2 2.9 11.4c-1.3.5-1.3 1.2-.2 1.5l4.8 1.5 1.8 5.6c.2.7.4.9 1 .9.6 0 .9-.3 1.2-.6l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.3-.5-1.9-1.4-1.5z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function HealthDot({
  ok,
  warn,
  label,
}: {
  ok: boolean;
  warn?: boolean;
  label: string;
}) {
  const color = ok
    ? "bg-emerald-400"
    : warn
      ? "bg-amber-400"
      : "bg-red-500";
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${color}`}
      title={label}
      aria-label={label}
    />
  );
}

interface OversightControlsProps {
  session: Session | null;
  project: string;
  topic: string;
  projects: Project[];
  models: Model[];
  model: string;
  modelsLoading: boolean;
  runStatus: string;
  apiOk: boolean;
  cursorReady: boolean;
  onProjectChange: (project: string) => void;
  onModelChange: (model: string) => void;
  onNewSession: () => void;
  onStop: () => void;
}

export function OversightControls({
  session,
  project,
  topic,
  projects,
  models,
  model,
  modelsLoading,
  runStatus,
  apiOk,
  cursorReady,
  onProjectChange,
  onModelChange,
  onNewSession,
  onStop,
}: OversightControlsProps) {
  const running = runStatus === "running";

  return (
    <header
      className="shrink-0 border-b border-zinc-800/80 bg-zinc-950/95 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-xl sm:px-4 sm:pb-2.5"
      data-component="OversightControls"
      data-testid="oversight-controls"
      data-state={running ? "running" : runStatus}
    >
      <div
        className="flex items-center gap-2"
        data-testid="oversight-controls__bar"
        data-section="header-bar"
      >
        <div
          className="min-w-0 flex-1 text-left"
          data-testid="chat-identity"
          data-section="chat-identity"
        >
          <div
            className="flex items-center justify-start gap-1.5"
            data-testid="chat-identity__title"
          >
            <h1
              className="truncate text-[17px] font-semibold tracking-tight text-zinc-50 lg:text-[15px]"
              data-testid="chat-topic"
              title={topic}
            >
              {topic}
            </h1>
            {running && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 lg:hidden"
                data-testid="run-status-pill"
                data-state="running"
                title="Running"
                aria-label="Running"
              />
            )}
            {running && (
              <span
                className="hidden shrink-0 rounded-full bg-amber-950/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-400 lg:inline"
                data-testid="run-status-pill-label"
                data-state="running"
              >
                running
              </span>
            )}
          </div>
          <p
            className="mt-0.5 flex items-center justify-start gap-1.5 truncate text-[12px] text-zinc-500 lg:hidden"
            data-testid="chat-context"
          >
            <span
              className="inline-flex items-center gap-1"
              data-testid="health-dots"
              aria-label="Connection status"
            >
              <HealthDot
                ok={apiOk}
                label={apiOk ? "bridge ok" : "bridge down"}
              />
              <HealthDot
                ok={cursorReady}
                warn={!cursorReady && apiOk}
                label={cursorReady ? "cursor ready" : "cursor not ready"}
              />
            </span>
          </p>
        </div>

        <div
          className="flex shrink-0 items-center gap-1"
          data-testid="oversight-controls__actions"
          data-section="header-actions"
        >
          <div className="hidden items-center gap-1 lg:flex">
            {session?.telegramTopicUrl ? (
              <a
                href={session.telegramTopicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-10 min-w-10 items-center justify-center rounded-full text-sky-400 active:bg-zinc-800 active:text-sky-300"
                aria-label="Open in Telegram"
                title="Open in Telegram"
                data-testid="open-telegram-topic-link"
              >
                <TelegramIcon className="h-4 w-4" />
              </a>
            ) : null}
            <TelegramSend />
            <a
              href={REMOTE_HEALTH_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-10 min-w-10 items-center justify-center rounded-full text-zinc-400 active:bg-zinc-800 active:text-zinc-200"
              aria-label="Open remote health check"
              data-testid="remote-health-link"
            >
              <ExternalLinkIcon className="h-4 w-4" />
            </a>
          </div>
          {session?.telegramTopicUrl ? (
            <a
              href={session.telegramTopicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-10 min-w-10 items-center justify-center rounded-full text-sky-400 active:bg-zinc-800 lg:hidden"
              aria-label="Open in Telegram"
              title="Open in Telegram"
              data-testid="open-telegram-topic-link-mobile"
            >
              <TelegramIcon className="h-5 w-5" />
            </a>
          ) : null}
          {running && (
            <button
              type="button"
              onClick={onStop}
              className="min-h-10 rounded-full bg-red-900/60 px-3 text-sm font-medium text-red-200 active:bg-red-900"
              data-testid="stop-button"
            >
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={onNewSession}
            className="flex min-h-10 min-w-10 items-center justify-center rounded-full text-sky-400 active:bg-zinc-800 lg:min-w-0 lg:gap-1.5 lg:border lg:border-zinc-700 lg:px-3 lg:text-sm lg:text-zinc-300"
            data-testid="new-session-button"
            aria-label="New session"
          >
            <PlusIcon className="h-5 w-5 lg:h-4 lg:w-4" />
            <span className="hidden lg:inline">New</span>
          </button>
        </div>
      </div>

      <div
        className="mt-2 grid grid-cols-2 gap-2"
        data-testid="oversight-controls__selectors"
        data-section="selectors"
      >
        <Select
          value={project}
          onValueChange={(value) => {
            if (value != null) onProjectChange(value);
          }}
          items={projects.map((p) => ({ value: p.id, label: p.name }))}
        >
          <SelectTrigger
            className="h-10 min-h-10 w-full rounded-xl text-[15px] data-[size=default]:h-10 sm:text-sm"
            aria-label="Project"
            data-testid="project-select"
          >
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="start">
            <SelectGroup>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          value={model}
          onValueChange={(value) => {
            if (value != null) onModelChange(value);
          }}
          disabled={modelsLoading || models.length === 0}
          items={models.map((m) => ({
            value: m.id,
            label: m.displayName || m.id,
          }))}
        >
          <SelectTrigger
            className="h-10 min-h-10 w-full rounded-xl text-[15px] data-[size=default]:h-10 sm:text-sm"
            aria-label="Model"
            data-testid="model-select"
            title={
              session
                ? "Applies to new sessions; active session keeps its model"
                : "Model for new sessions"
            }
          >
            <SelectValue placeholder="Model" />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="start">
            <SelectGroup>
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.displayName || m.id}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </header>
  );
}
