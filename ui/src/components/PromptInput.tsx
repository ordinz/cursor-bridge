import { useState } from "react";

interface PromptInputProps {
  disabled: boolean;
  running: boolean;
  onSend: (prompt: string) => Promise<void>;
}

export function PromptInput({ disabled, running, onSend }: PromptInputProps) {
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

  const inputDisabled = disabled || sending;

  return (
    <form
      onSubmit={handleSubmit}
      className="shrink-0 border-t border-zinc-800 bg-zinc-950 p-3 sm:p-4"
      data-testid="manual-override"
      aria-label="Prompt"
    >
      <label
        htmlFor="prompt-input"
        className="mb-1 block text-sm font-medium text-zinc-200"
      >
        Prompt
      </label>
      <p className="mb-2 text-xs text-zinc-500">
        Type a task and press Send. This is how you send prompts from this page
        — not via MCP.
      </p>
      {running && (
        <p className="mb-2 text-xs text-amber-400/90">
          Agent is working — wait or press Stop to send another prompt.
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <textarea
          id="prompt-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={inputDisabled}
          rows={2}
          placeholder="Describe what you want the agent to do…"
          className="min-h-11 flex-1 resize-none rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-50 sm:text-sm"
          data-testid="manual-override-input"
        />
        <button
          type="submit"
          disabled={inputDisabled || !prompt.trim()}
          className="min-h-11 shrink-0 rounded-md bg-zinc-700 px-4 py-2.5 text-base font-medium text-zinc-100 active:bg-zinc-600 disabled:opacity-40 sm:self-end sm:text-sm"
          data-testid="manual-override-send"
        >
          Send
        </button>
      </div>
    </form>
  );
}
