import { useEffect, useState } from "react";
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
  const [host, setHost] = useState("localhost:4242");

  useEffect(() => {
    setHost(window.location.host || "localhost:4242");
  }, []);

  return (
    <footer
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-[10px] text-zinc-500 sm:px-4 sm:py-2 sm:text-[11px] lg:gap-x-4"
      data-testid="status-bar"
    >
      <span data-testid="status-port">{host}</span>
      <span className={apiOk ? "text-emerald-600" : "text-red-500"}>
        {apiOk ? "bridge ok" : "bridge down"}
      </span>
      <span className={cursorReady ? "text-emerald-600" : "text-amber-500"}>
        {cursorReady ? "cursor ready" : "cursor not ready"}
      </span>
      {bridgeVersion && (
        <span className="hidden sm:inline" data-testid="status-version">
          v{bridgeVersion}
        </span>
      )}
      {session && (
        <>
          <span className="hidden lg:inline" data-testid="status-session">
            session={session.sessionId}
          </span>
          <span className="hidden lg:inline" data-testid="status-agent">
            agent={session.agentId}
          </span>
          <span className="hidden lg:inline" data-testid="status-cwd">
            cwd={session.cwd}
          </span>
          <span className="hidden lg:inline" data-testid="status-model">
            model={session.model}
          </span>
        </>
      )}
      <span data-testid="status-run">run={runStatus}</span>
    </footer>
  );
}
