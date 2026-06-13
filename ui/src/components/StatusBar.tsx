import type { Session } from "../lib/types";

interface StatusBarProps {
  session: Session | null;
  runStatus: string;
  apiOk: boolean;
  cursorReady: boolean;
  bridgeVersion?: string;
}

export function StatusBar({
  session,
  runStatus,
  apiOk,
  cursorReady,
  bridgeVersion,
}: StatusBarProps) {
  return (
    <footer
      className="hidden shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-800 bg-zinc-950 px-4 py-2 font-mono text-[11px] text-zinc-500 lg:flex"
      data-testid="status-bar"
    >
      <span data-testid="status-port">localhost:4242</span>
      <span className={apiOk ? "text-emerald-600" : "text-red-500"}>
        {apiOk ? "bridge ok" : "bridge down"}
      </span>
      <span className={cursorReady ? "text-emerald-600" : "text-amber-500"}>
        {cursorReady ? "cursor ready" : "cursor not ready"}
      </span>
      {bridgeVersion && (
        <span data-testid="status-version">v{bridgeVersion}</span>
      )}
      {session && (
        <>
          <span data-testid="status-session">session={session.sessionId}</span>
          <span data-testid="status-agent">agent={session.agentId}</span>
          <span data-testid="status-cwd">cwd={session.cwd}</span>
          <span data-testid="status-model">model={session.model}</span>
        </>
      )}
      <span data-testid="status-run">run={runStatus}</span>
    </footer>
  );
}
