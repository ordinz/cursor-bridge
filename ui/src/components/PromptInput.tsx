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
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

const INCLUDE_LOGS_KEY = "cursor-bridge-include-dev-logs-v1";
const MAX_IMAGE_EDGE = 1280;
const JPEG_QUALITY = 0.82;

interface PromptInputProps {
  disabled: boolean;
  running: boolean;
  devStatus: DevStatus | null;
  onSend: (
    prompt: string,
    options: { includeDevLogs: boolean },
  ) => Promise<void>;
}

type ImageAttachment = {
  id: string;
  name: string;
  previewUrl: string;
  dataUrl: string;
  bytes: number;
};

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

function buildPromptWithImages(text: string, images: ImageAttachment[]) {
  if (!images.length) return text;
  const blocks = images
    .map((img) => `![${img.name}](${img.dataUrl})`)
    .join("\n\n");
  const body = text.trim();
  return body ? `${body}\n\n${blocks}` : blocks;
}

export function PromptInput({
  disabled,
  running,
  devStatus,
  onSend,
}: PromptInputProps) {
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [includeDevLogs, setIncludeDevLogs] = useState(() => {
    try {
      return localStorage.getItem(INCLUDE_LOGS_KEY) === "true";
    } catch {
      return false;
    }
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

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
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [prompt]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if ((!prompt.trim() && images.length === 0) || disabled || sending) return;
    setSending(true);
    try {
      const body = buildPromptWithImages(
        prompt.trim() || "See attached image(s).",
        images,
      );
      await onSend(body, { includeDevLogs });
      setPrompt("");
      setImages([]);
      setImageError(null);
    } finally {
      setSending(false);
    }
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

  const inputDisabled = disabled || sending;
  const canSend =
    !inputDisabled && (Boolean(prompt.trim()) || images.length > 0);
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
      className="shrink-0 border-t border-zinc-800/80 bg-zinc-950/95 px-3 py-2 backdrop-blur-xl sm:px-4 sm:py-3"
      data-component="PromptInput"
      data-testid="prompt-input"
      data-section="composer"
      aria-label="Message composer"
      data-state={running ? "running" : inputDisabled ? "disabled" : "idle"}
    >
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

      <div className="flex items-end gap-2">
        <Popover open={attachOpen} onOpenChange={setAttachOpen}>
          <PopoverTrigger
            type="button"
            disabled={inputDisabled}
            className={cn(
              "mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
              hasAttachments
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 active:bg-zinc-800 active:text-zinc-300",
              "disabled:opacity-40",
            )}
            data-testid="include-dev-logs"
            data-state={attachOpen ? "open" : hasAttachments ? "armed" : "idle"}
            aria-label="Attach"
          >
            <PaperclipIcon className="h-[18px] w-[18px]" />
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
        <textarea
          ref={textareaRef}
          id="prompt-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={inputDisabled}
          rows={1}
          placeholder={running ? "Agent is working…" : "Message"}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-[22px] border border-zinc-700/80 bg-zinc-900 px-4 py-2.5 text-base leading-snug text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
          data-testid="prompt-input__field"
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />

        <button
          type="submit"
          disabled={!canSend}
          className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white transition-colors active:bg-sky-400 disabled:bg-zinc-800 disabled:text-zinc-600"
          data-testid="prompt-input__send"
          aria-label="Send"
        >
          <SendIcon className="h-5 w-5" />
        </button>
      </div>
    </form>
  );
}
