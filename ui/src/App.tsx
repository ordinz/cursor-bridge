import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryStates } from "nuqs";
import { getHealth, getDevStatus } from "./lib/api";
import type { DevStatus, HealthResponse } from "./lib/types";
import { consoleUrlParsers, type MobilePanel } from "./lib/url-state";
import { ActivityFeed } from "./components/ActivityFeed";
import { InstructionsPanel } from "./components/InstructionsPanel";
import { MobileTabBar } from "./components/MobileTabBar";
import { OversightControls } from "./components/OversightControls";
import { PromptInput } from "./components/PromptInput";
import { SessionSidebar } from "./components/SessionSidebar";
import { StatusBar } from "./components/StatusBar";
import { TraceabilityInspector } from "./components/dev/TraceabilityInspector";
import { useAgentHistory } from "./hooks/useAgentHistory";
import { useChatSession, SESSION_STORAGE_KEY } from "./hooks/useChatSession";
import { useModels } from "./hooks/useModels";
import { useProjects } from "./hooks/useProjects";

export default function App() {
  const { projects, loading: projectsLoading } = useProjects();
  const { models, selectedModel, selectModel, loading: modelsLoading } =
    useModels();
  const [{ project, tab: mobilePanel, agent: urlAgent }, setUrlState] =
    useQueryStates(
      {
        project: consoleUrlParsers.project,
        tab: consoleUrlParsers.tab,
        agent: consoleUrlParsers.agent,
      },
      { history: "replace" },
    );
  const setMobilePanel = useCallback(
    (next: MobilePanel) => {
      void setUrlState({ tab: next });
    },
    [setUrlState],
  );
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [devStatus, setDevStatus] = useState<DevStatus | null>(null);

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

  const setProject = useCallback(
    (next: string) => {
      if (next === project) return;
      clearSession();
      void setUrlState({ project: next, agent: null });
    },
    [project, clearSession, setUrlState],
  );

  const setUrlAgent = useCallback(
    (agentId: string | null) => {
      void setUrlState({ agent: agentId });
    },
    [setUrlState],
  );

  const topic = useMemo(() => {
    const name = session?.name?.trim();
    return name || "New chat";
  }, [session?.name]);

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

  const devStatusProject = session?.project ?? project;

  useEffect(() => {
    void getDevStatus(devStatusProject)
      .then(setDevStatus)
      .catch(() => setDevStatus(null));
    const interval = window.setInterval(() => {
      void getDevStatus(devStatusProject)
        .then(setDevStatus)
        .catch(() => setDevStatus(null));
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [devStatusProject]);

  useEffect(() => {
    if (runStatus === "running") {
      setMobilePanel("feed");
    }
  }, [runStatus, setMobilePanel]);

  // Session is source of truth while active — push agent id into the URL.
  useEffect(() => {
    if (!session?.agentId) return;
    if (urlAgent === session.agentId) return;
    setUrlAgent(session.agentId);
  }, [session?.agentId, urlAgent, setUrlAgent]);

  // Resume when URL has an agent and we don't have a live session yet.
  useEffect(() => {
    if (projectsLoading || session || !urlAgent) return;

    let cancelled = false;
    void resumeAgent(urlAgent, project, selectedModel).catch(() => {
      if (!cancelled) setUrlAgent(null);
    });
    return () => {
      cancelled = true;
    };
  }, [
    projectsLoading,
    session,
    urlAgent,
    project,
    selectedModel,
    resumeAgent,
    setUrlAgent,
  ]);

  // One-shot migrate: old localStorage session → URL when no ?agent=.
  useEffect(() => {
    if (projectsLoading || session || urlAgent) return;

    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return;

    try {
      const stored = JSON.parse(raw) as {
        agentId: string;
        project: string;
      };
      if (stored.project !== project) return;
      setUrlAgent(stored.agentId);
    } catch {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [projectsLoading, session, urlAgent, project, setUrlAgent]);

  useEffect(() => {
    if (!session?.name) return;
    void refreshAgents();
  }, [session?.name, refreshAgents]);

  const handleNewSession = useCallback(() => {
    clearSession();
    void setUrlState({ agent: null, tab: "feed" });
  }, [clearSession, setUrlState]);

  const handleResumeAgent = useCallback(
    async (agentId: string) => {
      if (session?.agentId === agentId) {
        setMobilePanel("feed");
        return;
      }
      clearSession();
      await setUrlState({ agent: agentId, tab: "feed" });
    },
    [session?.agentId, clearSession, setUrlState, setMobilePanel],
  );

  const handlePromptSend = useCallback(
    async (prompt: string, options: { includeDevLogs: boolean }) => {
      let active = session;
      if (!active) {
        active = await startSession(project, selectedModel);
      }
      setMobilePanel("feed");
      await sendPrompt(prompt, "manual", active, {
        includeDevLogs: options.includeDevLogs,
      });
      void refreshAgents();
    },
    [
      session,
      project,
      selectedModel,
      startSession,
      sendPrompt,
      refreshAgents,
      setMobilePanel,
    ],
  );

  const handleTldr = useCallback(
    (text: string) => {
      const excerpt = text.trim().slice(0, 6000);
      void handlePromptSend(
        [
          "TLDR the message below into a short compact summary.",
          "Use a few bullets or 2–3 sentences. Do not redo the work — only compress what was already said.",
          "",
          "<<<",
          excerpt,
          ">>>",
        ].join("\n"),
        { includeDevLogs: false },
      );
    },
    [handlePromptSend],
  );

  const handleDeleteAgent = useCallback(
    async (agentId: string) => {
      try {
        await deleteHistoryAgent(agentId);
        if (session?.agentId === agentId || urlAgent === agentId) {
          clearSession();
          await setUrlState({ agent: null });
        }
      } catch (err) {
        console.error(err);
      }
    },
    [deleteHistoryAgent, session, urlAgent, clearSession, setUrlState],
  );

  const running = runStatus === "running";
  const activeAgentId = session?.agentId ?? urlAgent;

  const conversationContent = (
    <>
      {projectsLoading && (
        <div
          className="p-4 text-sm text-zinc-500"
          data-testid="projects-loading"
          data-section="projects-loading"
        >
          Loading projects…
        </div>
      )}
      {error && (
        <div
          className="border-b border-red-900/40 bg-red-950/20 px-4 py-2 text-sm text-red-300"
          data-testid="console-error"
          data-section="error"
          role="alert"
        >
          {error}
        </div>
      )}
      {historyLoading && (
        <div
          className="border-b border-zinc-800 px-4 py-2 text-sm text-zinc-500"
          data-testid="history-loading"
          data-section="history-loading"
        >
          Loading conversation history…
        </div>
      )}
      <ActivityFeed
        items={feed}
        running={running}
        onTldr={handleTldr}
      />
      <PromptInput
        disabled={!apiOk || !cursorReady || running}
        running={running}
        devStatus={devStatus}
        onSend={handlePromptSend}
      />
    </>
  );

  return (
    <div
      className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-zinc-950 text-zinc-100"
      aria-label="cursor-bridge agent console"
      data-component="AgentConsole"
      data-testid="agent-console"
      data-page="ui"
      data-state={running ? "running" : runStatus}
    >
      <TraceabilityInspector />
      <OversightControls
        session={session}
        project={project}
        topic={topic}
        projects={projects}
        models={models}
        model={selectedModel}
        modelsLoading={modelsLoading}
        runStatus={runStatus}
        apiOk={apiOk}
        cursorReady={cursorReady}
        onProjectChange={setProject}
        onModelChange={selectModel}
        onNewSession={handleNewSession}
        onStop={() => void stopRun()}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SessionSidebar
          project={project}
          agents={agents}
          agentsLoading={agentsLoading}
          deletingId={deletingId}
          activeAgentId={activeAgentId}
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
          data-component="ConversationPanel"
          data-testid="conversation-panel"
          data-section="conversation"
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
        className="hidden lg:flex"
      />

      <MobileTabBar active={mobilePanel} onChange={setMobilePanel} />
    </div>
  );
}
