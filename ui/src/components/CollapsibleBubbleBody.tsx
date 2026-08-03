import { useLayoutEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const DEFAULT_PREVIEW_LINES = 12;
const DEFAULT_PREVIEW_CHARS = 700;
/** ~8 lines at text-sm */
const DEFAULT_CLAMP_PX = 160;

/** Stricter defaults for outbound user bubbles. */
export const USER_BUBBLE_PREVIEW_LINES = 6;
export const USER_BUBBLE_PREVIEW_CHARS = 280;

/** Assistant messages at/above this length get a TLDR reaction. */
export const ASSISTANT_TLDR_MIN_CHARS = DEFAULT_PREVIEW_CHARS;

export function isLongAssistantMessage(text: string) {
  return text.trim().length >= ASSISTANT_TLDR_MIN_CHARS;
}

interface CollapsibleBubbleBodyProps {
  /** Raw text used to decide whether collapsing is needed (and for plain previews). */
  text: string;
  children?: ReactNode;
  /** `plain` truncates by lines/chars; `rich` clamps rendered height (markdown). */
  mode?: "plain" | "rich";
  previewLines?: number;
  /** Soft character budget for the collapsed preview (plain mode). */
  minChars?: number;
  clampPx?: number;
  className?: string;
  fadeFrom?: "primary" | "secondary" | "muted" | "destructive" | "transparent";
}

function splitPlainPreview(
  text: string,
  previewLines: number,
  previewChars: number,
): { preview: string; rest: string } | null {
  const lines = text.split("\n");

  if (lines.length > previewLines) {
    return {
      preview: lines.slice(0, previewLines).join("\n"),
      rest: lines.slice(previewLines).join("\n"),
    };
  }

  if (text.length > previewChars) {
    let cut = previewChars;
    const nearbyNl = text.lastIndexOf("\n", previewChars);
    const nearbySpace = text.lastIndexOf(" ", previewChars);
    if (nearbyNl >= previewChars * 0.4) {
      cut = nearbyNl;
    } else if (nearbySpace >= previewChars * 0.5) {
      cut = nearbySpace;
    }
    return {
      preview: text.slice(0, cut).trimEnd(),
      rest: text.slice(cut).trimStart(),
    };
  }

  return null;
}

const fadeClass: Record<
  NonNullable<CollapsibleBubbleBodyProps["fadeFrom"]>,
  string
> = {
  primary: "from-primary",
  secondary: "from-secondary",
  muted: "from-muted",
  destructive: "from-destructive/10",
  transparent: "from-zinc-950",
};

export function CollapsibleBubbleBody({
  text,
  children,
  mode = "plain",
  previewLines = DEFAULT_PREVIEW_LINES,
  minChars = DEFAULT_PREVIEW_CHARS,
  clampPx = DEFAULT_CLAMP_PX,
  className,
  fadeFrom = "secondary",
}: CollapsibleBubbleBodyProps) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [measureEl, setMeasureEl] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (mode !== "rich" || !measureEl) {
      setOverflows(false);
      return;
    }
    const check = () => {
      setOverflows(measureEl.scrollHeight > clampPx + 8);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(measureEl);
    return () => ro.disconnect();
  }, [mode, measureEl, clampPx, text]);

  if (mode === "plain") {
    const split = splitPlainPreview(text, previewLines, minChars);
    if (!split) {
      return (
        <div className={cn("whitespace-pre-wrap wrap-break-word", className)}>
          {children ?? text}
        </div>
      );
    }

    return (
      <div
        className={cn("w-full min-w-0", className)}
        data-testid="bubble-collapsible"
        data-state={open ? "open" : "closed"}
      >
        <div className="whitespace-pre-wrap wrap-break-word">
          {open ? text : `${split.preview}${split.rest ? "…" : ""}`}
        </div>
        <button
          type="button"
          className="mt-1.5 text-xs font-medium text-current/70 underline decoration-current/30 underline-offset-2 outline-none hover:text-current focus-visible:ring-2 focus-visible:ring-ring/50"
          data-testid="bubble-show-more"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      </div>
    );
  }

  // rich / markdown
  return (
    <div
      className={cn("w-full min-w-0", className)}
      data-testid="bubble-collapsible"
      data-state={open ? "open" : overflows ? "closed" : "short"}
    >
      <div className="relative min-w-0">
        <div
          ref={setMeasureEl}
          className={cn("min-w-0", !open && overflows && "overflow-hidden")}
          style={!open && overflows ? { maxHeight: clampPx } : undefined}
        >
          {children}
        </div>
        {!open && overflows && (
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t to-transparent",
              fadeClass[fadeFrom],
            )}
            aria-hidden
          />
        )}
      </div>
      {overflows && (
        <button
          type="button"
          className="mt-1.5 text-xs font-medium text-current/70 underline decoration-current/30 underline-offset-2 outline-none hover:text-current focus-visible:ring-2 focus-visible:ring-ring/50"
          data-testid="bubble-show-more"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
