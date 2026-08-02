import {
  sendTelegramMessage,
  sendTelegramRichMessage,
  sendTelegramRichMessageDraft,
  TELEGRAM_RICH_MESSAGE_MAX_LENGTH,
} from "./telegram.js";
import { buildTelegramRichContent } from "./telegram-format.js";

const DEFAULT_THROTTLE_MS = 450;
const TOOL_GAP_PING_MS = 45_000;

/**
 * Assistant reply streamer for Telegram forums.
 * - Short "running…" status (plain)
 * - Optional rich HTML drafts (ephemeral) — silent buffer if drafts unsupported
 * - Exactly one rich HTML final message (no plain-draft duplicates)
 *
 * @param {{ messageThreadId?: number|null, throttleMs?: number }} opts
 */
export function createDraftStreamer(opts = {}) {
  const messageThreadId = opts.messageThreadId ?? null;
  const throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS;

  const draftId = (Date.now() % 2_147_483_647) || 1;
  let buffer = "";
  /** @type {"rich-draft" | "silent" | "none"} */
  let mode = "rich-draft";
  let timer = null;
  let lastFlushAt = 0;
  let gapTimer = null;
  let finalized = false;
  let startedStatusSent = false;
  let flushInFlight = null;
  let finalizedSent = false;

  async function doFlush() {
    if (finalized || !buffer.trim() || mode !== "rich-draft") return;
    lastFlushAt = Date.now();
    const { html } = buildTelegramRichContent(
      buffer.slice(0, TELEGRAM_RICH_MESSAGE_MAX_LENGTH),
    );

    try {
      await sendTelegramRichMessageDraft({
        draftId,
        html,
        messageThreadId,
      });
    } catch (err) {
      // Forum groups often reject drafts — keep buffering silently until finalize.
      mode = "silent";
      console.warn(
        "[telegram] rich draft unavailable, will send one final rich message:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  function scheduleFlush(force = false) {
    if (finalized || mode !== "rich-draft") return;
    const now = Date.now();
    const due = force || now - lastFlushAt >= throttleMs;
    if (!due) {
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          flushInFlight = doFlush();
        }, throttleMs - (now - lastFlushAt));
        if (typeof timer.unref === "function") timer.unref();
      }
      return;
    }
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    flushInFlight = doFlush();
  }

  function scheduleGapPing() {
    if (gapTimer) clearTimeout(gapTimer);
    gapTimer = setTimeout(() => {
      if (finalized) return;
      void sendTelegramMessage({
        text: "still working…",
        messageThreadId,
      }).catch(() => {});
      scheduleGapPing();
    }, TOOL_GAP_PING_MS);
    if (typeof gapTimer.unref === "function") gapTimer.unref();
  }

  return {
    async noteStarted() {
      if (startedStatusSent || finalized) return;
      startedStatusSent = true;
      try {
        await sendTelegramMessage({
          text: "running…",
          messageThreadId,
        });
      } catch {
        // ignore
      }
      scheduleGapPing();
    },

    /** @param {string} delta */
    push(delta) {
      if (finalized || !delta) return;
      buffer += delta;
      scheduleGapPing();
      scheduleFlush(false);
    },

    /** @param {string} [finalText] */
    async finalize(finalText) {
      if (finalized) return;
      finalized = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (gapTimer) {
        clearTimeout(gapTimer);
        gapTimer = null;
      }
      if (flushInFlight) {
        await flushInFlight.catch(() => {});
      }

      if (typeof finalText === "string" && finalText.length > buffer.length) {
        buffer = finalText;
      }

      const text = buffer.trim();
      if (!text) {
        if (!finalizedSent) {
          finalizedSent = true;
          await sendTelegramMessage({
            text: "(no assistant text)",
            messageThreadId,
          }).catch(() => {});
        }
        return;
      }

      if (finalizedSent) return;
      finalizedSent = true;

      // One last ephemeral draft if supported, then a single rich permanent message.
      if (mode === "rich-draft") {
        await doFlush().catch(() => {});
      }

      const { html, plainFallback } = buildTelegramRichContent(text);
      await sendTelegramRichMessage({
        html,
        plainFallback,
        messageThreadId,
      });
    },

    async fail(message) {
      await this.finalize();
      await sendTelegramMessage({
        text: `error: ${message || "run failed"}`,
        messageThreadId,
      }).catch(() => {});
    },

    getBuffer() {
      return buffer;
    },
  };
}
