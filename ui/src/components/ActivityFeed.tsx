import { useMemo, useRef, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FeedItem } from "../lib/types";
import {
  parseMessageAttachments,
  type ParsedMessageImage,
} from "../lib/message-attachments";
import {
  CollapsibleBubbleBody,
  isLongAssistantMessage,
  USER_BUBBLE_PREVIEW_CHARS,
  USER_BUBBLE_PREVIEW_LINES,
} from "./CollapsibleBubbleBody";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import {
  Bubble,
  BubbleContent,
  BubbleReactions,
} from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "@/components/ui/marker";
import { Spinner } from "@/components/ui/spinner";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";

function truncate(value: unknown, max = 400) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
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
      data-testid="feed-tool-status"
      data-state={status}
    >
      {status}
    </span>
  );
}

function ImageLightbox({
  image,
  onClose,
}: {
  image: ParsedMessageImage;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={image.name}
      className="fixed inset-0 z-50 m-0 h-dvh max-h-dvh w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black/85 open:flex open:items-center open:justify-center open:p-3 sm:open:p-6"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      data-testid="feed-image-lightbox"
      data-state="open"
    >
      <div
        className="relative flex max-h-full max-w-full flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
        data-testid="feed-image-lightbox__panel"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-1 right-0 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-lg text-zinc-200 backdrop-blur-sm active:bg-black/70 sm:-right-1"
          aria-label="Close"
          data-testid="feed-image-lightbox__close"
        >
          ✕
        </button>
        <img
          src={image.dataUrl}
          alt={image.name}
          className="max-h-[min(85dvh,900px)] max-w-[min(100vw-1.5rem,960px)] rounded-lg object-contain shadow-2xl"
          data-testid="feed-image-lightbox__image"
        />
        <p className="max-w-full truncate px-2 text-center text-xs text-zinc-400">
          {image.name}
        </p>
      </div>
    </dialog>
  );
}

function UserMessageBody({ text }: { text: string }) {
  const { text: displayText, images } = useMemo(
    () => parseMessageAttachments(text),
    [text],
  );
  const [preview, setPreview] = useState<ParsedMessageImage | null>(null);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {displayText ? (
        <CollapsibleBubbleBody
          text={displayText}
          mode="plain"
          previewLines={USER_BUBBLE_PREVIEW_LINES}
          minChars={USER_BUBBLE_PREVIEW_CHARS}
          fadeFrom="primary"
        />
      ) : null}
      {images.length > 0 && (
        <AttachmentGroup
          className="gap-2"
          data-testid="feed-user-attachments"
        >
          {images.map((img, i) => (
            <Attachment
              key={`${img.name}-${i}`}
              size="sm"
              orientation="vertical"
              className="cursor-zoom-in border-white/15 bg-white/10"
              data-testid="feed-user-attachment-image"
            >
              <AttachmentTrigger
                aria-label={`View ${img.name}`}
                onClick={() => setPreview(img)}
                data-testid="feed-user-attachment-image__open"
              />
              <AttachmentMedia variant="image" className="w-full">
                <img src={img.dataUrl} alt={img.name} />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle className="text-primary-foreground">
                  {img.name}
                </AttachmentTitle>
                <AttachmentDescription className="text-primary-foreground/70">
                  Image
                </AttachmentDescription>
              </AttachmentContent>
            </Attachment>
          ))}
        </AttachmentGroup>
      )}
      {preview ? (
        <ImageLightbox image={preview} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
}

function FeedEntry({
  item,
  compactTool,
  running,
  onTldr,
}: {
  item: FeedItem;
  compactTool?: boolean;
  running?: boolean;
  onTldr?: (text: string) => void;
}) {
  switch (item.kind) {
    case "user":
      return (
        <Bubble
          variant="default"
          align="end"
          data-component="FeedUserBubble"
          data-item="FeedUser"
          data-testid="feed-user"
          data-feed-id={item.id}
          data-section="feed-user"
        >
          <BubbleContent className="min-w-0 max-w-full">
            <UserMessageBody text={item.text} />
          </BubbleContent>
        </Bubble>
      );
    case "assistant": {
      const showTldr = Boolean(onTldr) && isLongAssistantMessage(item.text);
      return (
        <Bubble
          variant="secondary"
          align="start"
          className={showTldr ? "mb-4" : undefined}
          data-component="FeedAssistantBubble"
          data-item="FeedAssistant"
          data-testid="feed-assistant"
          data-feed-id={item.id}
          data-section="feed-assistant"
        >
          <BubbleContent className="min-w-0 max-w-full">
            <CollapsibleBubbleBody
              text={item.text}
              mode="rich"
              fadeFrom="secondary"
            >
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {item.text}
                </ReactMarkdown>
              </div>
            </CollapsibleBubbleBody>
          </BubbleContent>
          {showTldr ? (
            <BubbleReactions
              side="bottom"
              align="start"
              data-testid="feed-assistant-reactions"
            >
              <Button
                type="button"
                variant="secondary"
                size="xs"
                disabled={running}
                aria-label="Request a TLDR of this message"
                data-testid="feed-assistant-tldr"
                onClick={() => onTldr?.(item.text)}
              >
                TLDR
              </Button>
            </BubbleReactions>
          ) : null}
        </Bubble>
      );
    }
    case "tool":
      if (compactTool) {
        return (
          <Bubble
            variant="ghost"
            align="start"
            data-component="FeedToolBubble"
            data-item="FeedTool"
            data-testid="feed-tool"
            data-feed-id={item.id}
            data-state={item.status}
          >
            <BubbleContent className="flex items-center gap-2 px-0 py-0.5 text-xs text-zinc-500">
              <span className="font-mono text-zinc-400">{item.name}</span>
              <StatusPill status={item.status} compact />
            </BubbleContent>
          </Bubble>
        );
      }
      return (
        <Bubble
          variant="muted"
          align="start"
          data-component="FeedToolBubble"
          data-item="FeedTool"
          data-testid="feed-tool"
          data-feed-id={item.id}
          data-state={item.status}
        >
          <BubbleContent className="py-1.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono text-zinc-400">{item.name}</span>
              <StatusPill status={item.status} compact />
            </div>
            {item.args !== undefined && (
              <pre className="mt-1 overflow-x-auto text-[10px] text-zinc-600">
                {truncate(item.args, 200)}
              </pre>
            )}
          </BubbleContent>
        </Bubble>
      );
    case "status": {
      const finished =
        item.status === "FINISHED" ||
        item.status === "finished" ||
        /^finished$/i.test(item.status);
      const label = item.message?.trim() || item.status;
      return (
        <Marker
          data-component="FeedStatusMarker"
          data-item="FeedStatus"
          data-testid="feed-status"
          data-feed-id={item.id}
          data-state={item.status}
        >
          <MarkerContent className={finished ? "text-zinc-500" : undefined}>
            {label}
          </MarkerContent>
        </Marker>
      );
    }
    case "error":
      return (
        <Bubble
          variant="destructive"
          align="start"
          data-component="FeedErrorBubble"
          data-item="FeedError"
          data-testid="feed-error"
          data-feed-id={item.id}
        >
          <BubbleContent className="min-w-0 max-w-full">
            <CollapsibleBubbleBody
              text={item.message}
              mode="plain"
              fadeFrom="destructive"
            >
              <div className="whitespace-pre-wrap">{item.message}</div>
            </CollapsibleBubbleBody>
          </BubbleContent>
        </Bubble>
      );
    default:
      return null;
  }
}

interface ActivityFeedProps {
  items: FeedItem[];
  running: boolean;
  onTldr?: (text: string) => void;
}

export function ActivityFeed({
  items,
  running,
  onTldr,
}: ActivityFeedProps) {
  const [showTools, setShowTools] = useState(false);

  const toolCount = useMemo(
    () => items.filter((i) => i.kind === "tool").length,
    [items],
  );

  const visibleItems = useMemo(() => {
    const base = showTools ? items : items.filter((i) => i.kind !== "tool");
    // RUNNING / "Run started" are ephemeral — live footer shows Working….
    return base.filter(
      (i) =>
        !(
          i.kind === "status" &&
          (i.status === "RUNNING" ||
            i.status === "running" ||
            /^run started/i.test(i.message ?? ""))
        ),
    );
  }, [items, showTools]);

  const isEmpty = items.length === 0;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-component="ActivityFeed"
      data-testid="activity-feed-panel"
      data-state={running ? "running" : isEmpty ? "empty" : "idle"}
    >
      <div
        className="flex shrink-0 items-center justify-end border-b border-zinc-800/60 px-3 py-1.5 sm:px-4"
        data-section="feed-toolbar"
        data-testid="activity-feed__toolbar"
      >
        {toolCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowTools((v) => !v)}
            className="flex min-h-9 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-zinc-400 active:bg-zinc-800 hover:text-zinc-200"
            data-testid="toggle-tool-calls"
            data-state={showTools ? "shown" : "hidden"}
          >
            {showTools ? "Hide tools" : "Show tools"}
            {!showTools && (
              <span className="rounded-full bg-zinc-800 px-1.5 text-[10px] text-zinc-500">
                {toolCount}
              </span>
            )}
          </button>
        ) : (
          <span className="h-9" aria-hidden />
        )}
      </div>

      <MessageScrollerProvider
        autoScroll
        defaultScrollPosition="last-anchor"
        scrollPreviousItemPeek={64}
      >
        <MessageScroller
          className="min-h-0 flex-1"
          data-testid="activity-feed-scroller"
        >
          <MessageScrollerViewport
            data-testid="activity-feed"
            id="activity-feed"
            data-section="feed-list"
            aria-label="Activity feed"
          >
            <MessageScrollerContent
              className="gap-3 p-3 sm:p-4"
              aria-busy={running}
              data-testid="activity-feed__messages"
            >
              {isEmpty ? (
                <MessageScrollerItem messageId="feed-empty">
                  <div
                    className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-center text-sm text-zinc-500"
                    data-testid="activity-feed__empty"
                    data-section="empty"
                  >
                    <p>Send a message to start.</p>
                  </div>
                </MessageScrollerItem>
              ) : null}
              {visibleItems.map((item) => (
                <MessageScrollerItem
                  key={item.id}
                  messageId={item.id}
                  scrollAnchor={item.kind === "user"}
                >
                  <FeedEntry
                    item={item}
                    compactTool={showTools}
                    running={running}
                    onTldr={onTldr}
                  />
                </MessageScrollerItem>
              ))}
              {running ? (
                <MessageScrollerItem messageId="feed-running">
                  <Marker
                    role="status"
                    data-testid="feed-running"
                    data-state="running"
                    data-component="FeedRunningMarker"
                  >
                    <MarkerIcon>
                      <Spinner className="size-3.5 text-amber-400/90" />
                    </MarkerIcon>
                    <MarkerContent className="shimmer text-amber-400/90">
                      Working…
                    </MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton data-testid="activity-feed__jump-latest" />
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  );
}
