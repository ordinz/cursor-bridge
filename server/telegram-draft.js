import {
  sendTelegramMessage,
  sendTelegramRichMessage,
  sendTelegramRichMessageDraft,
  TELEGRAM_RICH_MESSAGE_MAX_LENGTH,
} from "./telegram.js";
import { buildTelegramRichContent } from "./telegram-format.js";

const DEFAULT_THROTTLE_MS = 450;

/**
 * Assistant reply streamer for Telegram forums.
 * - One short "running…" at start (no recurring "still working…" spam)
 * - Optional rich HTML drafts when supported; otherwise silent buffer
 * - Exactly one rich HTML final message
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
  let finalized = false;
  let startedStatusSent = false;
  let flushInFlight = null;
  let finalizedSent = false;
  let lastProgressAt = 0;
  let doneSent = false;

  function clearTimers() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

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
    clearTimers();
    flushInFlight = doFlush();
  }

  async function finish(finalText) {
    if (finalized) return;
    finalized = true;
    clearTimers();
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

    if (mode === "rich-draft") {
      await doFlush().catch(() => {});
    }

    const { html, plainFallback } = buildTelegramRichContent(text);
    await sendTelegramRichMessage({
      html,
      plainFallback,
      messageThreadId,
    });
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
    },

    /** Throttled progress ping during long tool/shell work (no assistant text yet). */
    async noteProgress(text) {
      if (finalized || !text?.trim()) return;
      const now = Date.now();
      if (now - lastProgressAt < 4000) return;
      lastProgressAt = now;
      try {
        await sendTelegramMessage({
          text: `⏳ ${text}`.slice(0, 4000),
          messageThreadId,
        });
      } catch {
        // ignore
      }
    },

    async noteDone() {
      if (finalized || doneSent) return;
      doneSent = true;
      try {
        await sendTelegramMessage({
          text: "✅ done",
          messageThreadId,
        });
      } catch {
        // ignore
      }
    },

    /** @param {string} delta */
    push(delta) {
      if (finalized || !delta) return;
      buffer += delta;
      scheduleFlush(false);
    },

    /** @param {string} [finalText] */
    async finalize(finalText) {
      await finish(finalText);
    },

    /** Stop timers without posting (e.g. send() threw before a run existed). */
    async abort(message) {
      if (finalized) return;
      finalized = true;
      clearTimers();
      if (flushInFlight) {
        await flushInFlight.catch(() => {});
      }
      if (message && !finalizedSent) {
        finalizedSent = true;
        await sendTelegramMessage({
          text: message,
          messageThreadId,
        }).catch(() => {});
      }
    },

    async fail(message) {
      await finish();
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
