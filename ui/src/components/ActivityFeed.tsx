import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FeedItem } from "../lib/types";

function truncate(value: unknown, max = 400) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function FeedEntry({
  item,
  compactTool,
}: {
  item: FeedItem;
  compactTool?: boolean;
}) {
  switch (item.kind) {
    case "user":
      return (
        <div
          className="rounded-lg border border-zinc-700 bg-zinc-900/80 px-4 py-3"
          data-testid="feed-user"
        >
          <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
            {item.source === "manual"
              ? "Prompt"
              : item.source === "history"
                ? "Previous prompt"
                : "Prompt"}
          </div>
          <p className="whitespace-pre-wrap text-sm text-zinc-100">{item.text}</p>
        </div>
      );
    case "assistant":
      return (
        <div
          className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3"
          data-testid="feed-assistant"
        >
          <div className="mb-2 text-xs uppercase tracking-wide text-emerald-500/80">
            Assistant
          </div>
          <div className="markdown-body text-sm text-zinc-200">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
          </div>
        </div>
      );
    case "tool":
      if (compactTool) {
        return (
          <div
            className="flex items-center gap-2 rounded border border-zinc-800/80 bg-zinc-900/40 px-3 py-1.5 text-xs text-zinc-500"
            data-testid="feed-tool"
          >
            <span className="font-mono text-zinc-400">{item.name}</span>
            <StatusPill status={item.status} compact />
          </div>
        );
      }
      return (
        <div
          className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
          data-testid="feed-tool"
        >
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-zinc-400">{item.name}</span>
            <StatusPill status={item.status} compact />
          </div>
          {item.args !== undefined && (
            <pre className="mt-1 overflow-x-auto text-[10px] text-zinc-600">
              {truncate(item.args, 200)}
            </pre>
          )}
        </div>
      );
    case "status":
      return (
        <div className="text-xs text-zinc-500" data-testid="feed-status">
          Status: {item.status}
          {item.message ? ` — ${item.message}` : ""}
        </div>
      );
    case "error":
      return (
        <div
          className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300"
          data-testid="feed-error"
        >
          {item.message}
        </div>
      );
    default:
      return null;
  }
}

function StatusPill({
  status,
  compact,
}: {
  status: string;
  compact?: boolean;
}) {
  const colors: Record<string, string> = {
    running: "text-amber-400",
    completed: "text-emerald-400",
    error: "text-red-400",
  };
  return (
    <span
      className={`${colors[status] ?? "text-zinc-400"} ${compact ? "text-[10px] uppercase" : ""}`}
    >
      {status}
    </span>
  );
}

interface ActivityFeedProps {
  items: FeedItem[];
  running: boolean;
  onOpenInstructions?: () => void;
}

export function ActivityFeed({
  items,
  running,
  onOpenInstructions,
}: ActivityFeedProps) {
  const [showTools, setShowTools] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const toolCount = useMemo(
    () => items.filter((i) => i.kind === "tool").length,
    [items],
  );

  const visibleItems = useMemo(
    () => (showTools ? items : items.filter((i) => i.kind !== "tool")),
    [items, showTools],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (running || nearBottom) {
      bottomRef.current?.scrollIntoView({
        behavior: running ? "instant" : "smooth",
      });
    }
  }, [items, running]);

  const isEmpty = items.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/80 px-3 py-2 sm:px-4">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Conversation
        </span>
        {toolCount > 0 && (
          <button
            type="button"
            onClick={() => setShowTools((v) => !v)}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            data-testid="toggle-tool-calls"
          >
            {showTools ? "Hide tool calls" : "Show tool calls"}
            {!showTools && (
              <span className="rounded-full bg-zinc-800 px-1.5 text-[10px] text-zinc-500">
                {toolCount}
              </span>
            )}
          </button>
        )}
      </div>

      <div
        ref={containerRef}
        className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3 sm:p-4"
        data-testid="activity-feed"
        id="activity-feed"
      >
        {isEmpty && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-zinc-500">
            <p>Send a prompt below to start.</p>
            {onOpenInstructions && (
              <button
                type="button"
                onClick={onOpenInstructions}
                className="text-zinc-400 underline decoration-zinc-600 underline-offset-2 hover:text-zinc-200"
              >
                Open Instructions for setup steps
              </button>
            )}
          </div>
        )}
        {visibleItems.map((item) => (
          <FeedEntry
            key={item.id}
            item={item}
            compactTool={showTools}
          />
        ))}
        {running && (
          <div className="text-xs text-amber-400/80" data-testid="feed-running">
            Run in progress…
          </div>
        )}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
    </div>
  );
}
