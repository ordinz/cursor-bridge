import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FeedItem } from "../lib/types";

function truncate(value: unknown, max = 400) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function FeedEntry({ item }: { item: FeedItem }) {
  switch (item.kind) {
    case "user":
      return (
        <div
          className="rounded-lg border border-zinc-700 bg-zinc-900/80 px-4 py-3"
          data-testid="feed-user"
        >
          <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
            {item.source === "manual"
              ? "Manual override"
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
      return (
        <div
          className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3"
          data-testid="feed-tool"
        >
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide">
            <span className="text-amber-400">Tool</span>
            <span className="font-mono text-zinc-300">{item.name}</span>
            <StatusPill status={item.status} />
          </div>
          {item.args !== undefined && (
            <pre className="mt-2 overflow-x-auto rounded bg-zinc-950 p-2 text-xs text-zinc-400">
              {truncate(item.args)}
            </pre>
          )}
          {item.result !== undefined && item.status !== "running" && (
            <pre className="mt-2 overflow-x-auto rounded bg-zinc-950 p-2 text-xs text-zinc-300">
              {truncate(item.result, 800)}
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

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "text-amber-400",
    completed: "text-emerald-400",
    error: "text-red-400",
  };
  return (
    <span className={colors[status] ?? "text-zinc-400"}>{status}</span>
  );
}

interface ActivityFeedProps {
  items: FeedItem[];
  running: boolean;
}

export function ActivityFeed({ items, running }: ActivityFeedProps) {
  return (
    <div
      className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3 sm:p-4"
      data-testid="activity-feed"
    >
      {items.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
          Waiting for agent activity…
        </div>
      )}
      {items.map((item) => (
        <FeedEntry key={item.id} item={item} />
      ))}
      {running && (
        <div className="text-xs text-amber-400/80" data-testid="feed-running">
          Run in progress…
        </div>
      )}
    </div>
  );
}
