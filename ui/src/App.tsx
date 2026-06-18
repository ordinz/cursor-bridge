import { useCallback, useEffect, useState } from "react";
import { getHealth } from "./lib/api";
import type { HealthResponse } from "./lib/types";
import { ActivityFeed } from "./components/ActivityFeed";
import { InstructionsPanel } from "./components/InstructionsPanel";
import {
  MobileTabBar,
  type MobilePanel,
} from "./components/MobileTabBar";
import { OversightControls } from "./components/OversightControls";
import { PromptInput } from "./components/PromptInput";
import { SessionSidebar } from "./components/SessionSidebar";
import { StatusBar } from "./components/StatusBar";
import { useAgentHistory } from "./hooks/useAgentHistory";
import { useChatSession, SESSION_STORAGE_KEY } from "./hooks/useChatSession";
import { useModels } from "./hooks/useModels";
import { useProjects } from "./hooks/useProjects";

export default function App() {
  const { projects, loading: projectsLoading } = useProjects();
  const { models, selectedModel, selectModel, loading: modelsLoading } =
    useModels();
  const [project, setProject] = useState("app");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("instructions");

  const apiOk = health?.ok ?? false;
  const cursorReady = health?.cursor.ready ?? false;

  const {
    agents,
    loading: agentsLoading,
    deletingId,
    refresh: refreshAgents,
    deleteAgent: deleteHistoryAgent,
  } = useAgentHistory(project);

  const {
    session,
    feed,
    runStatus,
    error,
    historyLoading,
    startSession,
    resumeAgent,
    sendPrompt,
    stopRun,
    clearSession,
  } = useChatSession();

  useEffect(() => {
    const enabled = projects.filter((p) => p.canCreateSession !== false);
    if (!enabled.length) return;
    if (!enabled.some((p) => p.id === project)) {
      setProject(enabled[0].id);
    }
  }, [projects, project]);

  useEffect(() => {
    void getHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
    const interval = window.setInterval(() => {
      void getHealth()
        .then(setHealth)
        .catch(() => setHealth(null));
    }, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (runStatus === "running") {
      setMobilePanel("feed");
    }
  }, [runStatus]);

  useEffect(() => {
    if (!session && feed.length === 0) {
      setMobilePanel("instructions");
    }
  }, [session, feed.length]);

  useEffect(() => {
    if (projectsLoading || session) return;

    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return;

    try {
      const stored = JSON.parse(raw) as {
        agentId: string;
        project: string;
        model?: string;
      };
      if (stored.project !== project) return;
      void resumeAgent(
        stored.agentId,
        stored.project,
        stored.model ?? selectedModel,
      );
    } catch {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [projectsLoading, session, project, selectedModel, resumeAgent]);

  useEffect(() => {
    if (!session?.name) return;
    void refreshAgents();
  }, [session?.name, refreshAgents]);

  const handleNewSession = useCallback(async () => {
    try {
      await startSession(project, selectedModel);
      setMobilePanel("feed");
      void refreshAgents();
    } catch (err) {
      console.error(err);
    }
  }, [project, selectedModel, startSession, refreshAgents]);

  const handleResumeAgent = useCallback(
    async (agentId: string) => {
      try {
        await resumeAgent(agentId, project, selectedModel);
        setMobilePanel("feed");
      } catch (err) {
        console.error(err);
      }
    },
    [project, selectedModel, resumeAgent],
  );

  const handlePromptSend = useCallback(
    async (prompt: string) => {
      let active = session;
      if (!active) {
        active = await startSession(project, selectedModel);
      }
      setMobilePanel("feed");
      await sendPrompt(prompt, "manual", active);
      void refreshAgents();
    },
    [session, project, selectedModel, startSession, sendPrompt, refreshAgents],
  );

  const handleDeleteAgent = useCallback(
    async (agentId: string) => {
      const agent = agents.find((a) => a.agentId === agentId);
      const label = agent?.name?.trim() || agentId.slice(0, 16);
      if (
        !window.confirm(
          `Delete agent "${label}"?\n\nThis permanently removes its conversation history and cannot be undone.`,
        )
      ) {
        return;
      }

      try {
        await deleteHistoryAgent(agentId);
        if (session?.agentId === agentId) {
          clearSession();
        }
      } catch (err) {
        console.error(err);
      }
    },
    [agents, deleteHistoryAgent, session, clearSession],
  );

  const running = runStatus === "running";

  const conversationContent = (
    <>
      {projectsLoading && (
        <div className="p-4 text-sm text-zinc-500">Loading projects…</div>
      )}
      {error && (
        <div className="border-b border-red-900/40 bg-red-950/20 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      {historyLoading && (
        <div className="border-b border-zinc-800 px-4 py-2 text-sm text-zinc-500">
          Loading conversation history…
        </div>
      )}
      <ActivityFeed
        items={feed}
        running={running}
        onOpenInstructions={() => setMobilePanel("instructions")}
      />
      <PromptInput
        disabled={!apiOk || !cursorReady || running}
        running={running}
        onSend={handlePromptSend}
      />
    </>
  );

  return (
    <div
      className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-zinc-950 text-zinc-100"
      aria-label="cursor-bridge agent console"
    >
      <OversightControls
        session={session}
        project={project}
        projects={projects}
        models={models}
        model={selectedModel}
        modelsLoading={modelsLoading}
        runStatus={runStatus}
        onProjectChange={setProject}
        onModelChange={selectModel}
        onNewSession={() => void handleNewSession()}
        onStop={() => void stopRun()}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SessionSidebar
          project={project}
          agents={agents}
          agentsLoading={agentsLoading}
          deletingId={deletingId}
          activeAgentId={session?.agentId}
          onResumeAgent={(id) => void handleResumeAgent(id)}
          onDeleteAgent={(id) => void handleDeleteAgent(id)}
          className={
            mobilePanel === "history"
              ? "flex w-full min-w-0 lg:w-64"
              : "hidden lg:flex lg:w-64"
          }
        />

        <main
          className={
            mobilePanel === "instructions"
              ? "hidden min-w-0 flex-1 flex-col overflow-hidden"
              : "flex min-w-0 flex-1 flex-col overflow-hidden"
          }
          aria-label="Conversation"
        >
          {conversationContent}
        </main>

        <InstructionsPanel
          className={
            mobilePanel === "instructions"
              ? "flex min-w-0 flex-1 flex-col overflow-hidden"
              : "hidden"
          }
        />
      </div>

      <StatusBar
        session={session}
        runStatus={runStatus}
        apiOk={apiOk}
        cursorReady={cursorReady}
        bridgeVersion={health?.version}
      />

      <MobileTabBar active={mobilePanel} onChange={setMobilePanel} />
    </div>
  );
}
