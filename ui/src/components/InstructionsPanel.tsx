interface InstructionsPanelProps {
  className?: string;
}

export function InstructionsPanel({ className = "" }: InstructionsPanelProps) {
  return (
    <aside
      className={`flex min-w-0 flex-1 flex-col overflow-hidden bg-zinc-950 ${className}`}
      data-testid="instructions-panel"
      aria-label="Instructions for AI operators"
    >
      <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
        <h2 className="text-base font-semibold text-zinc-100">
          Instructions
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          You are on the cursor-bridge agent console. Send tasks through the{" "}
          <strong className="font-medium text-zinc-200">Prompt</strong> form at
          the bottom of the Conversation tab.
        </p>

        <div
          className="mt-4 rounded-lg border border-amber-900/50 bg-amber-950/20 px-4 py-3"
          role="note"
          data-testid="instructions-no-mcp"
        >
          <p className="text-sm font-medium text-amber-200">
            Do not use MCP
          </p>
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
              Confirm <strong className="text-zinc-300">bridge ok</strong> and{" "}
              <strong className="text-zinc-300">cursor ready</strong> in the
              status bar.
            </li>
            <li>Pick a project and model in the header.</li>
            <li>
              Type your task into{" "}
              <code className="rounded bg-zinc-800 px-1 text-zinc-300">
                #prompt-input
              </code>{" "}
              and press Send.
            </li>
            <li>
              Watch the conversation stream — it auto-scrolls while the agent
              is working.
            </li>
            <li>Press Stop in the header if you need to halt a run.</li>
          </ol>
        </section>

        <section className="mt-6" aria-labelledby="page-regions-heading">
          <h3
            id="page-regions-heading"
            className="text-sm font-medium text-zinc-200"
          >
            Page regions
          </h3>
          <ul className="mt-2 space-y-2 text-sm text-zinc-400">
            <li>
              <code className="rounded bg-zinc-800 px-1 text-zinc-300">
                #prompt-input
              </code>{" "}
              — send a task to the agent
            </li>
            <li>
              <code className="rounded bg-zinc-800 px-1 text-zinc-300">
                #activity-feed
              </code>{" "}
              — live conversation (prompts, replies, status)
            </li>
            <li>History sidebar — resume or delete past agents</li>
            <li>Header — project, model, New session, Stop</li>
          </ul>
        </section>

        <section className="mt-6" aria-labelledby="while-running-heading">
          <h3
            id="while-running-heading"
            className="text-sm font-medium text-zinc-200"
          >
            While the agent is running
          </h3>
          <p className="mt-2 text-sm text-zinc-400">
            The conversation feed auto-scrolls to show the latest output. The
            Prompt form is disabled until the run finishes or you press Stop.
          </p>
        </section>

        <section className="mt-6" aria-labelledby="advanced-heading">
          <h3
            id="advanced-heading"
            className="text-sm font-medium text-zinc-500"
          >
            Advanced (optional)
          </h3>
          <p className="mt-2 text-sm text-zinc-500">
            Only if this UI is unavailable: use same-origin{" "}
            <code className="rounded bg-zinc-800 px-1 text-zinc-400">
              fetch
            </code>{" "}
            to{" "}
            <code className="rounded bg-zinc-800 px-1 text-zinc-400">
              /api/sessions/.../chat
            </code>
            . See AGENT_API.md. Not needed when you can see this page.
          </p>
        </section>
      </div>
    </aside>
  );
}
