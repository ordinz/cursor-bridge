import { useEffect, useId, useRef, useState } from "react";
import type { DevStatus } from "../lib/types";
import { cn } from "../lib/utils";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
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
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { MessageQueue } from "./MessageQueue";
import {
  useMessageQueue,
  type QueuedMessage,
} from "../hooks/useMessageQueue";

const INCLUDE_LOGS_KEY = "cursor-bridge-include-dev-logs-v1";
const DRAFT_STORAGE_PREFIX = "cursor-bridge-prompt-draft-v1:";
const MAX_IMAGE_EDGE = 1280;
const JPEG_QUALITY = 0.82;

export type PromptSendOptions = {
  includeDevLogs: boolean;
  images?: Array<{ data: string; mimeType: string; name?: string }>;
  /** Inject into a busy agent without waiting for the current run. */
  allowOverlap?: boolean;
};

interface PromptInputProps {
  disabled: boolean;
  running: boolean;
  devStatus: DevStatus | null;
  /** Scopes the persisted composer draft (e.g. project:agent). */
  draftKey: string;
  onSend: (prompt: string, options: PromptSendOptions) => Promise<void>;
}

type ImageAttachment = {
  id: string;
  name: string;
  previewUrl: string;
  dataUrl: string;
  bytes: number;
};

type StoredDraft = {
  prompt: string;
  images: Array<{
    id: string;
    name: string;
    dataUrl: string;
    bytes: number;
  }>;
};

function draftStorageKey(draftKey: string) {
  return `${DRAFT_STORAGE_PREFIX}${draftKey}`;
}

function newDraftKeyFor(draftKey: string): string | null {
  const sep = draftKey.indexOf(":");
  if (sep < 0) return null;
  const project = draftKey.slice(0, sep);
  const agent = draftKey.slice(sep + 1);
  if (!project || agent === "new") return null;
  return `${project}:new`;
}

/** Only migrate `:new` → agent when that is the actual navigation we just took. */
function shouldMigrateFromNew(
  prevKey: string | null,
  nextKey: string,
): boolean {
  if (!prevKey || prevKey === nextKey) return false;
  const prevSep = prevKey.indexOf(":");
  const nextSep = nextKey.indexOf(":");
  if (prevSep < 0 || nextSep < 0) return false;
  const prevProject = prevKey.slice(0, prevSep);
  const prevAgent = prevKey.slice(prevSep + 1);
  const nextProject = nextKey.slice(0, nextSep);
  const nextAgent = nextKey.slice(nextSep + 1);
  return (
    Boolean(prevProject) &&
    prevProject === nextProject &&
    prevAgent === "new" &&
    nextAgent !== "new"
  );
}

function loadDraft(draftKey: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(draftStorageKey(draftKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (typeof parsed?.prompt !== "string") return null;
    const images = Array.isArray(parsed.images)
      ? parsed.images.filter(
          (img): img is StoredDraft["images"][number] =>
            Boolean(img) &&
            typeof img.id === "string" &&
            typeof img.name === "string" &&
            typeof img.dataUrl === "string" &&
            typeof img.bytes === "number",
        )
      : [];
    return { prompt: parsed.prompt, images };
  } catch {
    return null;
  }
}

function isEmptyDraft(draft: StoredDraft | null): boolean {
  return !draft || (!draft.prompt && draft.images.length === 0);
}

/** Load draft for key; optionally take over `:new` after a real new→agent transition. */
function loadDraftWithMigration(
  draftKey: string,
  migrateFromNew: boolean,
): StoredDraft | null {
  const draft = loadDraft(draftKey);
  if (!migrateFromNew || !isEmptyDraft(draft)) return draft;

  const fromNewKey = newDraftKeyFor(draftKey);
  if (!fromNewKey) return draft;

  const fromNew = loadDraft(fromNewKey);
  if (isEmptyDraft(fromNew) || !fromNew) return draft;

  saveDraft(draftKey, fromNew);
  saveDraft(fromNewKey, { prompt: "", images: [] });
  return fromNew;
}

function saveDraft(draftKey: string, draft: StoredDraft) {
  const key = draftStorageKey(draftKey);
  if (!draft.prompt && draft.images.length === 0) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }

  const write = (payload: StoredDraft) => {
    localStorage.setItem(key, JSON.stringify(payload));
  };

  try {
    write(draft);
  } catch {
    try {
      write({ prompt: draft.prompt, images: [] });
    } catch {
      // ignore
    }
  }
}

function draftToAttachments(draft: StoredDraft | null): ImageAttachment[] {
  if (!draft?.images.length) return [];
  return draft.images.map((img) => ({
    ...img,
    previewUrl: img.dataUrl,
  }));
}

function logsActive(status: DevStatus | null): boolean {
  return Boolean(
    status?.capturing && (status.lineCount > 0 || status.fileRecent),
  );
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function fileToCompressedDataUrl(file: File): Promise<{
  dataUrl: string;
  previewUrl: string;
  bytes: number;
  name: string;
}> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  const bytes = Math.round(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return { dataUrl, previewUrl: dataUrl, bytes, name };
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M3.4 20.6 21 12 3.4 3.4l.1 6.8L15 12 3.5 13.8z" />
    </svg>
  );
}

function QueueIcon({ className }: { className?: string }) {
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
      <path d="M4 6h12" />
      <path d="M4 12h12" />
      <path d="M4 18h8" />
      <path d="M18 14v6" />
      <path d="M15 17h6" />
    </svg>
  );
}

function PaperclipIcon({ className }: { className?: string }) {
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
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function ImageIcon({ className }: { className?: string }) {
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
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function LogsIcon({ className }: { className?: string }) {
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
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function imagesToChatPayload(images: ImageAttachment[]) {
  return images.map((img) => {
    const comma = img.dataUrl.indexOf(",");
    const header = comma >= 0 ? img.dataUrl.slice(0, comma) : "";
    const data =
      comma >= 0 ? img.dataUrl.slice(comma + 1) : img.dataUrl;
    const mimeType =
      header.match(/^data:([^;,]+)/i)?.[1] || "image/jpeg";
    return { data, mimeType, name: img.name };
  });
}

function queuedImagesToAttachments(images: QueuedMessage["images"]): ImageAttachment[] {
  return images.map((img) => ({
    ...img,
    previewUrl: img.dataUrl,
  }));
}

function clearComposerDraft(
  draftKey: string,
  setPrompt: (v: string) => void,
  setImages: (v: ImageAttachment[]) => void,
  setImageError: (v: string | null) => void,
) {
  setPrompt("");
  setImages([]);
  setImageError(null);
  saveDraft(draftKey, { prompt: "", images: [] });
}

export function PromptInput({
  disabled,
  running,
  devStatus,
  draftKey,
  onSend,
}: PromptInputProps) {
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [showClear, setShowClear] = useState(false);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const [includeDevLogs, setIncludeDevLogs] = useState(() => {
    try {
      return localStorage.getItem(INCLUDE_LOGS_KEY) === "true";
    } catch {
      return false;
    }
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendingRef = useRef(false);
  const drainingRef = useRef(false);
  const pauseDrainRef = useRef(false);
  const wasRunningRef = useRef(running);
  /** One automatic drain when opening a thread that already has a saved queue. */
  const idleMountDrainRef = useRef(true);
  const prevDraftKeyRef = useRef<string | null>(null);
  /** Set when sending/queueing from `:new` so only that kickoff may claim the draft. */
  const pendingNewMigrationRef = useRef(false);
  const promptRef = useRef(prompt);
  const imagesRef = useRef(images);
  promptRef.current = prompt;
  imagesRef.current = images;
  const titleId = useId();
  const {
    queue,
    enqueue,
    remove,
    update,
    take,
    shift,
    unshift,
  } = useMessageQueue(draftKey, () => pendingNewMigrationRef.current);

  useEffect(() => {
    const prev = prevDraftKeyRef.current;
    const migrateFromNew =
      shouldMigrateFromNew(prev, draftKey) && pendingNewMigrationRef.current;
    if (migrateFromNew) pendingNewMigrationRef.current = false;

    // Flush the outgoing conversation's composer before swapping keys so a
    // fast switch can't drop the last keystroke (save effect skips while keys differ).
    if (prev && prev !== draftKey && hydratedKey === prev) {
      saveDraft(prev, {
        prompt: promptRef.current,
        images: imagesRef.current.map(({ id, name, dataUrl, bytes }) => ({
          id,
          name,
          dataUrl,
          bytes,
        })),
      });
    }
    prevDraftKeyRef.current = draftKey;

    // Mid-send `:new` → agent: keep composer as-is (cleared, or a follow-up typed
    // during the request). Unrelated switches always hydrate the target draft.
    if (sendingRef.current && migrateFromNew) {
      setHydratedKey(draftKey);
      return;
    }

    const draft = loadDraftWithMigration(draftKey, migrateFromNew);
    setPrompt(draft?.prompt ?? "");
    setImages(draftToAttachments(draft));
    setImageError(null);
    setHydratedKey(draftKey);
    setSending(false);
    idleMountDrainRef.current = true;
    pauseDrainRef.current = false;
    // hydratedKey/prompt/images intentionally read via refs / previous render only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    if (hydratedKey !== draftKey) return;
    saveDraft(draftKey, {
      prompt,
      images: images.map(({ id, name, dataUrl, bytes }) => ({
        id,
        name,
        dataUrl,
        bytes,
      })),
    });
  }, [draftKey, hydratedKey, prompt, images]);

  useEffect(() => {
    try {
      localStorage.setItem(INCLUDE_LOGS_KEY, String(includeDevLogs));
    } catch {
      // ignore
    }
  }, [includeDevLogs]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const scrollHeight = el.scrollHeight;
    el.style.height = `${Math.min(scrollHeight, 128)}px`;

    const styles = getComputedStyle(el);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 22;
    const paddingY =
      (Number.parseFloat(styles.paddingTop) || 0) +
      (Number.parseFloat(styles.paddingBottom) || 0);
    setShowClear(scrollHeight > lineHeight * 2 + paddingY + 1);
  }, [prompt]);

  async function dispatchSend(
    text: string,
    options: PromptSendOptions,
  ): Promise<boolean> {
    sendingRef.current = true;
    setSending(true);
    try {
      await onSend(text, options);
      return true;
    } catch {
      // Parent surfaces the error; caller may restore/re-queue.
      return false;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function sendQueuedMessage(
    item: QueuedMessage,
    options: { allowOverlap?: boolean; putBackOnFail?: boolean } = {},
  ) {
    const payloadImages = imagesToChatPayload(
      queuedImagesToAttachments(item.images),
    );
    const ok = await dispatchSend(item.prompt, {
      includeDevLogs: item.includeDevLogs,
      images: payloadImages.length ? payloadImages : undefined,
      allowOverlap: options.allowOverlap,
    });
    if (!ok && options.putBackOnFail !== false) {
      unshift(item);
    }
    return ok;
  }

  // Drain the queue when a run finishes (or once on idle mount with a saved queue).
  useEffect(() => {
    if (running) {
      wasRunningRef.current = true;
      pauseDrainRef.current = false;
      return;
    }

    // Stay armed while blocked so a later idle tick can still drain.
    if (disabled || sending || drainingRef.current) return;
    if (queue.length === 0) {
      idleMountDrainRef.current = false;
      return;
    }
    if (pauseDrainRef.current) return;

    const becameIdle = wasRunningRef.current;
    const mountDrain = idleMountDrainRef.current;
    if (!becameIdle && !mountDrain) return;

    // Consume the edge only once we commit to sending — never before the guards.
    wasRunningRef.current = false;
    idleMountDrainRef.current = false;

    drainingRef.current = true;
    const next = shift();
    if (!next) {
      drainingRef.current = false;
      return;
    }

    // Do not cancel/unshift on effect re-runs: shift() changes queue.length and
    // would otherwise tear down this effect, drop the becameIdle edge, and stall.
    void (async () => {
      try {
        const ok = await sendQueuedMessage(next, { putBackOnFail: true });
        if (!ok) pauseDrainRef.current = true;
      } finally {
        drainingRef.current = false;
      }
    })();
    // Intentionally keyed to run/idle + queue depth; send helpers close over latest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, disabled, sending, queue.length]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if ((!prompt.trim() && images.length === 0) || disabled) return;

    const text = prompt.trim() || "See attached image(s).";
    const queuedImages = images.map(({ id, name, dataUrl, bytes }) => ({
      id,
      name,
      dataUrl,
      bytes,
    }));
    const logs = includeDevLogs;
    if (draftKey.endsWith(":new")) {
      pendingNewMigrationRef.current = true;
    }

    // Agent busy (or kickoff in flight): always queue — never block typing.
    if (running || sendingRef.current) {
      enqueue({
        prompt: text,
        includeDevLogs: logs,
        images: queuedImages,
      });
      clearComposerDraft(draftKey, setPrompt, setImages, setImageError);
      return;
    }

    const payloadImages = imagesToChatPayload(images);
    // Clear first so the field never sits locked with the sent text.
    clearComposerDraft(draftKey, setPrompt, setImages, setImageError);

    const ok = await dispatchSend(text, {
      includeDevLogs: logs,
      images: payloadImages.length ? payloadImages : undefined,
    });
    if (!ok) {
      pendingNewMigrationRef.current = false;
      // Restore only if the user hasn't already started a follow-up.
      setPrompt((current) => current || text);
      setImages((current) =>
        current.length ? current : queuedImagesToAttachments(queuedImages),
      );
      setIncludeDevLogs(logs);
    }
  }

  async function handleSendNow(id: string) {
    if (disabled) return;
    const item = take(id);
    if (!item) return;
    await sendQueuedMessage(item, {
      allowOverlap: running || sendingRef.current,
      putBackOnFail: true,
    });
  }

  function handleEditInComposer(id: string) {
    const item = take(id);
    if (!item) return;
    setPrompt(item.prompt);
    setImages(queuedImagesToAttachments(item.images));
    setIncludeDevLogs(item.includeDevLogs);
    setImageError(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function handleImageFiles(files: readonly File[]) {
    if (!files.length) return;
    setImageError(null);
    try {
      const next: ImageAttachment[] = [];
      for (const [index, file] of Array.from(files).entries()) {
        if (!file.type.startsWith("image/")) {
          setImageError("Only image files are supported");
          continue;
        }
        const namedFile =
          file.name && !/^image\.(png|jpe?g|webp|gif)$/i.test(file.name)
            ? file
            : new File(
                [file],
                `pasted-image-${index + 1}.jpg`,
                { type: file.type || "image/jpeg" },
              );
        const compressed = await fileToCompressedDataUrl(namedFile);
        next.push({
          id: `${namedFile.name}-${namedFile.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
          ...compressed,
        });
      }
      if (next.length) {
        setImages((prev) => [...prev, ...next].slice(0, 4));
        setAttachOpen(false);
      }
    } catch {
      setImageError("Could not read image");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const inputDisabled = disabled;
  const queueMode = running || sending;
  const canSend =
    !disabled && (Boolean(prompt.trim()) || images.length > 0);
  const capturing = logsActive(devStatus);
  const hasAttachments = includeDevLogs || images.length > 0;

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (inputDisabled) return;

    const pastedImages = Array.from(e.clipboardData.items)
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file != null);

    if (!pastedImages.length) return;

    e.preventDefault();
    void handleImageFiles(pastedImages);
  }

  const logsDescription = !includeDevLogs
    ? "Off"
    : capturing
      ? `${devStatus?.lineCount ?? 0} lines buffered`
      : devStatus?.devServerReachable
        ? `Dev on :${devStatus.port}`
        : "No active capture";

  return (
    <form
      onSubmit={handleSubmit}
      className="shrink-0 px-3 pb-2 pt-1 sm:px-4 sm:pb-2.5"
      data-component="PromptInput"
      data-testid="prompt-input"
      data-section="composer"
      aria-label="Message composer"
      data-state={running ? "running" : inputDisabled ? "disabled" : "idle"}
    >
      <MessageQueue
        items={queue}
        running={queueMode}
        busy={disabled}
        onEdit={handleEditInComposer}
        onDelete={remove}
        onSendNow={(id) => void handleSendNow(id)}
        onUpdate={(id, nextPrompt) => update(id, { prompt: nextPrompt })}
      />

      {hasAttachments && (
        <AttachmentGroup
          className="mb-2 gap-2"
          data-testid="prompt-attachments"
        >
          {includeDevLogs && (
            <Attachment
              size="sm"
              state={capturing ? "done" : "idle"}
              data-testid="attachment-dev-logs"
            >
              <AttachmentMedia>
                <LogsIcon />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>Dev logs</AttachmentTitle>
                <AttachmentDescription>{logsDescription}</AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction
                  type="button"
                  aria-label="Remove dev logs"
                  data-testid="attachment-dev-logs-remove"
                  onClick={() => setIncludeDevLogs(false)}
                >
                  <XIcon />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          )}
          {images.map((img) => (
            <Attachment
              key={img.id}
              size="sm"
              orientation="horizontal"
              data-testid="attachment-image"
            >
              <AttachmentMedia variant="image">
                <img src={img.previewUrl} alt="" />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{img.name}</AttachmentTitle>
                <AttachmentDescription>
                  Image · {formatBytes(img.bytes)}
                </AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction
                  type="button"
                  aria-label={`Remove ${img.name}`}
                  data-testid="attachment-image-remove"
                  onClick={() =>
                    setImages((prev) => prev.filter((i) => i.id !== img.id))
                  }
                >
                  <XIcon />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          ))}
        </AttachmentGroup>
      )}

      {imageError && (
        <p
          className="mb-2 px-1 text-xs text-red-400"
          data-testid="attach-image-error"
        >
          {imageError}
        </p>
      )}

      <div className="flex items-end gap-1.5">
        <Popover open={attachOpen} onOpenChange={setAttachOpen}>
          <PopoverTrigger
            type="button"
            disabled={inputDisabled}
            className={cn(
              "mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
              hasAttachments
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 active:bg-zinc-800 active:text-zinc-300",
              "disabled:opacity-40",
            )}
            data-testid="include-dev-logs"
            data-state={attachOpen ? "open" : hasAttachments ? "armed" : "idle"}
            aria-label="Attach"
          >
            <PaperclipIcon className="h-4 w-4" />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="top"
            sideOffset={8}
            className="w-72 gap-2 border border-zinc-700/80 bg-zinc-900 p-2"
            data-testid="attach-popover"
            aria-labelledby={titleId}
          >
            <PopoverHeader className="px-1.5 pt-1">
              <PopoverTitle id={titleId}>Attach</PopoverTitle>
              <PopoverDescription>
                Include context with your next message.
              </PopoverDescription>
            </PopoverHeader>

            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                includeDevLogs
                  ? "bg-emerald-950/40 text-emerald-100"
                  : "text-zinc-200 active:bg-zinc-800",
              )}
              data-testid="attach-dev-logs"
              data-state={includeDevLogs ? "on" : "off"}
              onClick={() => setIncludeDevLogs((v) => !v)}
            >
              <span
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800",
                  includeDevLogs && "text-emerald-400",
                )}
              >
                <LogsIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Dev logs</span>
                <span className="block truncate text-xs text-zinc-500">
                  {logsDescription}
                </span>
              </span>
              <span className="text-xs text-zinc-500">
                {includeDevLogs ? "On" : "Off"}
              </span>
            </button>

            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start gap-3 px-2 py-2 text-zinc-200"
              data-testid="attach-image"
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800">
                <ImageIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-medium">Image</span>
                <span className="block text-xs font-normal text-zinc-500">
                  Photo or screenshot
                </span>
              </span>
            </Button>

            {imageError && attachOpen && (
              <p
                className="px-2 text-xs text-red-400"
                data-testid="attach-popover-image-error"
              >
                {imageError}
              </p>
            )}
          </PopoverContent>
        </Popover>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          data-testid="attach-image-input"
          onChange={(e) => void handleImageFiles(Array.from(e.target.files ?? []))}
        />

        <label className="sr-only" htmlFor="prompt-input">
          Message
        </label>
        <div className="relative min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            id="prompt-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={inputDisabled}
            rows={1}
            placeholder={
              queueMode
                ? queue.length
                  ? "Add another to the queue…"
                  : "Queue a follow-up…"
                : "Message"
            }
            style={{ fontSize: 16 }}
            className={cn(
              "max-h-32 min-h-10 w-full resize-none rounded-[20px] border border-zinc-700/80 bg-zinc-900 px-3.5 py-2 leading-snug text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-50",
              showClear && "pr-9",
            )}
            data-testid="prompt-input__field"
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (canSend) {
                  e.currentTarget.form?.requestSubmit();
                }
              }
            }}
          />
          {showClear && (
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <button
                    type="button"
                    className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                    data-testid="prompt-input__clear"
                    aria-label="Clear message"
                    title="Clear message"
                  />
                }
              >
                <XIcon className="h-3.5 w-3.5" />
              </AlertDialogTrigger>
              <AlertDialogContent size="sm" data-testid="prompt-clear-dialog">
                <AlertDialogHeader>
                  <AlertDialogMedia>
                    <XIcon className="size-6" />
                  </AlertDialogMedia>
                  <AlertDialogTitle>Clear message?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the text in the composer. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="prompt-clear-cancel">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    data-testid="prompt-clear-confirm"
                    onClick={() => {
                      setPrompt("");
                      requestAnimationFrame(() => textareaRef.current?.focus());
                    }}
                  >
                    Clear
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        <button
          type="submit"
          disabled={!canSend}
          className={cn(
            "mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-colors disabled:bg-zinc-800 disabled:text-zinc-600",
            queueMode
              ? "bg-amber-500 active:bg-amber-400"
              : "bg-sky-500 active:bg-sky-400",
          )}
          data-testid="prompt-input__send"
          data-mode={queueMode ? "queue" : "send"}
          aria-label={queueMode ? "Add to queue" : "Send"}
          title={queueMode ? "Add to queue" : "Send"}
        >
          {queueMode ? (
            <QueueIcon className="h-4 w-4" />
          ) : (
            <SendIcon className="h-4 w-4" />
          )}
        </button>
      </div>
    </form>
  );
}
