import { useCallback, useEffect, useState } from "react";
import { getHealth } from "./lib/api";
import { ActivityFeed } from "./components/ActivityFeed";
import { ManualOverride } from "./components/ManualOverride";
import {
  MobileTabBar,
  type MobilePanel,
} from "./components/MobileTabBar";
import { OversightControls } from "./components/OversightControls";
import { SessionSidebar } from "./components/SessionSidebar";
import { StatusBar } from "./components/StatusBar";
import { ToolActivity } from "./components/ToolActivity";
import { useAgentHistory } from "./hooks/useAgentHistory";
import { useChatSession, SESSION_STORAGE_KEY } from "./hooks/useChatSession";
import { useModels } from "./hooks/useModels";
import { useProjects } from "./hooks/useProjects";

export default function App() {
  const { projects, root, loading: projectsLoading } = useProjects();
  const { models, selectedModel, selectModel, loading: modelsLoading } =
    useModels();
  const [project, setProject] = useState("app");
  const [apiOk, setApiOk] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("feed");

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

  const toolCount = feed.filter((i) => i.kind === "tool").length;

  useEffect(() => {
    const enabled = projects.filter((p) => p.enabled);
    if (!enabled.length) return;
    if (!enabled.some((p) => p.id === project)) {
      setProject(enabled[0].id);
    }
  }, [projects, project]);

  useEffect(() => {
    void getHealth()
      .then(() => setApiOk(true))
      .catch(() => setApiOk(false));
  }, []);

  useEffect(() => {
    if (runStatus === "running") {
      setMobilePanel("feed");
    }
  }, [runStatus]);

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

  const handleManualSend = useCallback(
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

  const mainContent = (
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
      <ActivityFeed items={feed} running={running} />
      <ManualOverride disabled={!apiOk || running} onSend={handleManualSend} />
    </>
  );

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-zinc-950 text-zinc-100">
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
            mobilePanel === "feed"
              ? "flex min-w-0 flex-1 flex-col overflow-hidden"
              : "hidden min-w-0 flex-1 flex-col overflow-hidden lg:flex"
          }
        >
          {mainContent}
        </main>

        <ToolActivity
          items={feed}
          className={
            mobilePanel === "tools"
              ? "flex w-full min-w-0 border-l-0 lg:w-80 lg:border-l"
              : "hidden lg:flex lg:w-80"
          }
        />
      </div>

      <StatusBar
        session={session}
        runStatus={runStatus}
        projectsRoot={root}
        apiOk={apiOk}
      />

      <MobileTabBar
        active={mobilePanel}
        onChange={setMobilePanel}
        toolCount={toolCount}
      />
    </div>
  );
}
