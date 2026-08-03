import { useEffect, useRef, useState } from "react";
import type { QueuedMessage } from "../hooks/useMessageQueue";
import { cn } from "../lib/utils";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function previewText(message: QueuedMessage) {
  const text = message.prompt.trim();
  if (text) return text;
  if (message.images.length) {
    return `${message.images.length} image${message.images.length === 1 ? "" : "s"}`;
  }
  return "Empty message";
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function BoltIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
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
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

interface MessageQueueProps {
  items: QueuedMessage[];
  running: boolean;
  busy?: boolean;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onSendNow: (id: string) => void;
  onUpdate: (id: string, prompt: string) => void;
}

export function MessageQueue({
  items,
  running,
  busy = false,
  onEdit,
  onDelete,
  onSendNow,
  onUpdate,
}: MessageQueueProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editingId) return;
    if (!items.some((m) => m.id === editingId)) {
      setEditingId(null);
      setDraft("");
    }
  }, [editingId, items]);

  useEffect(() => {
    if (!editingId) return;
    editRef.current?.focus();
    const el = editRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [editingId, draft]);

  if (items.length === 0) return null;

  function beginEdit(item: QueuedMessage) {
    setEditingId(item.id);
    setDraft(item.prompt);
  }

  function commitEdit(id: string) {
    const next = draft.trim();
    if (!next) {
      onDelete(id);
    } else {
      onUpdate(id, next);
    }
    setEditingId(null);
    setDraft("");
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft("");
  }

  return (
    <div
      className="mb-2 overflow-hidden rounded-xl border border-zinc-800/90 bg-zinc-900/70"
      data-component="MessageQueue"
      data-testid="message-queue"
      data-state={running ? "waiting" : "ready"}
      aria-label={`${items.length} queued message${items.length === 1 ? "" : "s"}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative flex h-2 w-2">
            {running && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/60" />
            )}
            <span
              className={cn(
                "relative inline-flex h-2 w-2 rounded-full",
                running ? "bg-amber-400" : "bg-sky-400",
              )}
            />
          </span>
          <p className="truncate text-xs font-medium text-zinc-300">
            Queue · {items.length}
          </p>
        </div>
        <p className="shrink-0 text-[11px] text-zinc-500">
          {running ? "Sends when free" : "Next up"}
        </p>
      </div>

      <ul className="divide-y divide-zinc-800/70" data-testid="message-queue__list">
        {items.map((item, index) => {
          const editing = editingId === item.id;
          const meta = [
            item.includeDevLogs ? "dev logs" : null,
            item.images.length
              ? `${item.images.length} image${item.images.length === 1 ? "" : "s"}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ");

          return (
            <li
              key={item.id}
              className="px-2.5 py-2"
              data-testid="message-queue__item"
              data-queue-index={index}
            >
              {editing ? (
                <div className="space-y-2">
                  <textarea
                    ref={editRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={2}
                    style={{ fontSize: 16 }}
                    className="max-h-24 w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm leading-snug text-zinc-100 focus:border-zinc-500 focus:outline-none"
                    data-testid="message-queue__edit-field"
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        cancelEdit();
                      }
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        commitEdit(item.id);
                      }
                    }}
                  />
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                      data-testid="message-queue__edit-cancel"
                      onClick={cancelEdit}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md bg-sky-500/15 px-2 py-1 text-xs font-medium text-sky-300 transition-colors hover:bg-sky-500/25"
                      data-testid="message-queue__edit-save"
                      onClick={() => commitEdit(item.id)}
                    >
                      <CheckIcon className="h-3 w-3" />
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-medium text-zinc-400">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 whitespace-pre-wrap text-sm leading-snug text-zinc-200">
                      {previewText(item)}
                    </p>
                    {(meta || item.images.length > 0) && (
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                        {meta}
                        {item.images[0]
                          ? `${meta ? " · " : ""}${formatBytes(
                              item.images.reduce((n, img) => n + img.bytes, 0),
                            )}`
                          : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      disabled={busy}
                      title={
                        running
                          ? "Send now to the running agent"
                          : "Send this message now"
                      }
                      aria-label="Send now"
                      className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-amber-200/90 transition-colors hover:bg-amber-500/10 disabled:opacity-40"
                      data-testid="message-queue__send-now"
                      onClick={() => onSendNow(item.id)}
                    >
                      <BoltIcon className="h-3 w-3" />
                      Now
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      title={
                        item.images.length || item.includeDevLogs
                          ? "Edit in composer"
                          : "Edit message"
                      }
                      aria-label="Edit queued message"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
                      data-testid="message-queue__edit"
                      onClick={() => {
                        if (item.images.length || item.includeDevLogs) {
                          onEdit(item.id);
                          return;
                        }
                        beginEdit(item);
                      }}
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      title="Remove from queue"
                      aria-label="Delete queued message"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-red-950/50 hover:text-red-300 disabled:opacity-40"
                      data-testid="message-queue__delete"
                      onClick={() => onDelete(item.id)}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
