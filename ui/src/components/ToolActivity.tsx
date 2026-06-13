import type { FeedItem } from "../lib/types";

function truncate(value: unknown, max = 300) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

interface ToolActivityProps {
  items: FeedItem[];
  className?: string;
}

export function ToolActivity({ items, className = "" }: ToolActivityProps) {
  const tools = items.filter((i) => i.kind === "tool");

  return (
    <aside
      className={`shrink-0 flex-col border-l border-zinc-800 bg-zinc-950/50 ${className}`}
      data-testid="tool-panel"
    >
      <div className="border-b border-zinc-800 px-4 py-3 text-sm font-medium text-zinc-300">
        Tool activity
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto overscroll-contain p-3">
        {tools.length === 0 && (
          <p className="text-xs text-zinc-500">No tool calls yet.</p>
        )}
        {tools.map((tool) =>
          tool.kind === "tool" ? (
            <div
              key={tool.callId}
              className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3"
              data-testid="tool-card"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-amber-300">
                  {tool.name}
                </span>
                <span className="text-[10px] uppercase text-zinc-500">
                  {tool.status}
                </span>
              </div>
              {tool.args !== undefined && (
                <pre className="mt-2 max-h-32 overflow-auto text-[10px] text-zinc-500">
                  {truncate(tool.args, 200)}
                </pre>
              )}
            </div>
          ) : null,
        )}
      </div>
    </aside>
  );
}
