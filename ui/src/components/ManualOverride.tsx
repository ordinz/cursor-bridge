import { useState } from "react";

interface ManualOverrideProps {
  disabled: boolean;
  onSend: (prompt: string) => Promise<void>;
}

export function ManualOverride({ disabled, onSend }: ManualOverrideProps) {
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || disabled || sending) return;
    setSending(true);
    try {
      await onSend(prompt.trim());
      setPrompt("");
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="shrink-0 border-t border-zinc-800 bg-zinc-950 p-3 sm:p-4"
      data-testid="manual-override"
    >
      <label className="mb-2 block text-xs uppercase tracking-wide text-zinc-500">
        Manual override
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={disabled || sending}
          rows={2}
          placeholder="Human intervention prompt…"
          className="min-h-11 flex-1 resize-none rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-50 sm:text-sm"
          data-testid="manual-override-input"
        />
        <button
          type="submit"
          disabled={disabled || sending || !prompt.trim()}
          className="min-h-11 shrink-0 rounded-md bg-zinc-700 px-4 py-2.5 text-base font-medium text-zinc-100 active:bg-zinc-600 disabled:opacity-40 sm:self-end sm:text-sm"
          data-testid="manual-override-send"
        >
          Send
        </button>
      </div>
    </form>
  );
}
