import { useEffect, useRef, useState } from "react";
import { sendTelegram } from "../lib/api";

interface TelegramFormProps {
  configured: boolean;
  autoFocus?: boolean;
  open?: boolean;
  showCancel?: boolean;
  onCancel?: () => void;
  onSent?: () => void;
}

export function TelegramForm({
  configured,
  autoFocus = false,
  open = true,
  showCancel = false,
  onCancel,
  onSent,
}: TelegramFormProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || !configured || sending) return;

    setSending(true);
    setFeedback(null);
    try {
      await sendTelegram(message.trim());
      setMessage("");
      setFeedback("Sent");
      onSent?.();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  const inputDisabled = !configured || sending;

  useEffect(() => {
    if (!open || !autoFocus) return;
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, autoFocus]);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <textarea
        ref={inputRef}
        value={message}
        onChange={(e) => {
          setMessage(e.target.value);
          if (feedback) setFeedback(null);
        }}
        disabled={inputDisabled}
        rows={4}
        autoFocus={autoFocus}
        placeholder={configured ? "Type your message…" : "Telegram not configured"}
        className="min-h-24 w-full resize-y rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#229ED9] focus:outline-none disabled:opacity-50"
        data-testid="telegram-send-input"
      />

      {feedback && (
        <p
          className={`text-xs ${feedback === "Sent" ? "text-emerald-500" : "text-red-400"}`}
          data-testid="telegram-send-feedback"
        >
          {feedback}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {showCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-10 rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 active:bg-zinc-800"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={inputDisabled || !message.trim()}
          className="min-h-10 rounded-md bg-[#229ED9] px-4 py-2 text-sm font-medium text-white active:bg-[#1a8bc4] disabled:opacity-40"
          data-testid="telegram-send-button"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}
