interface InstructionsPanelProps {
  className?: string;
}

export function InstructionsPanel({ className = "" }: InstructionsPanelProps) {
  return (
    <aside
      className={`flex min-w-0 flex-1 flex-col overflow-hidden bg-zinc-950 ${className}`}
      data-component="InstructionsPanel"
      data-testid="instructions-panel"
      data-section="help"
      aria-label="Help"
    >
      <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
        <h2 className="text-[17px] font-semibold tracking-tight text-zinc-100">
          Help
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Pick a project and model, then send a message in Chat. Watch the reply
          stream in the conversation. Use History to resume a past agent.
        </p>

        <div
          className="mt-4 rounded-2xl border border-amber-900/50 bg-amber-950/20 px-4 py-3"
          role="note"
          data-testid="instructions-no-mcp"
        >
          <p className="text-sm font-medium text-amber-200">Do not use MCP</p>
          <p className="mt-1 text-sm text-amber-100/80">
            If you are viewing this UI, do not call cursor-bridge MCP tools. MCP
            is for Cursor IDE integrations. On this page, use the Prompt input
            and watch the conversation feed.
          </p>
        </div>

        <section className="mt-6" aria-labelledby="quick-start-heading">
          <h3
            id="quick-start-heading"
            className="text-sm font-medium text-zinc-200"
          >
            Quick start
          </h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-zinc-400">
            <li>
              Confirm connection — green dots in the header (or{" "}
              <strong className="text-zinc-300">bridge ok</strong> /{" "}
              <strong className="text-zinc-300">cursor ready</strong> on
              desktop).
            </li>
            <li>Pick a project and model in the header.</li>
            <li>
              Type your task into{" "}
              <code className="rounded bg-zinc-800 px-1 text-zinc-300">
                #prompt-input
              </code>{" "}
              and press Send.
            </li>
            <li>Watch the conversation — it auto-scrolls while the agent works.</li>
            <li>Press Stop if you need to halt a run.</li>
          </ol>
        </section>

        <section className="mt-8" aria-labelledby="page-regions-heading">
          <h3
            id="page-regions-heading"
            className="text-sm font-medium text-zinc-500"
          >
            For AI operators
          </h3>
          <ul className="mt-2 space-y-2 text-sm text-zinc-500">
            <li>
              <code className="rounded bg-zinc-800 px-1 text-zinc-400">
                #prompt-input
              </code>{" "}
              — send a task to the agent
            </li>
            <li>
              <code className="rounded bg-zinc-800 px-1 text-zinc-400">
                #activity-feed
              </code>{" "}
              — live conversation (prompts, replies, status)
            </li>
            <li>History — resume or delete past agents</li>
            <li>Header — project, model, New session, Stop</li>
          </ul>
        </section>

        <section className="mt-6" aria-labelledby="while-running-heading">
          <h3
            id="while-running-heading"
            className="text-sm font-medium text-zinc-500"
          >
            While the agent is running
          </h3>
          <p className="mt-2 text-sm text-zinc-500">
            The conversation feed auto-scrolls to show the latest output. The
            Prompt form is disabled until the run finishes or you press Stop.
          </p>
        </section>

        <section className="mt-6" aria-labelledby="advanced-heading">
          <h3
            id="advanced-heading"
            className="text-sm font-medium text-zinc-600"
          >
            Advanced (optional)
          </h3>
          <p className="mt-2 text-sm text-zinc-600">
            Only if this UI is unavailable: use same-origin{" "}
            <code className="rounded bg-zinc-800 px-1 text-zinc-500">fetch</code>{" "}
            to{" "}
            <code className="rounded bg-zinc-800 px-1 text-zinc-500">
              /api/sessions/.../chat
            </code>
            . See AGENT_API.md. Not needed when you can see this page.
          </p>
        </section>
      </div>
    </aside>
  );
}
