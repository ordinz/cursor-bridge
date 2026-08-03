import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryStates } from "nuqs";
import { getHealth, getDevStatus } from "./lib/api";
import type { DevStatus, HealthResponse } from "./lib/types";
import { consoleUrlParsers, type MobilePanel } from "./lib/url-state";
import { ActivityFeed } from "./components/ActivityFeed";
import { MobileTabBar } from "./components/MobileTabBar";
import { OversightControls } from "./components/OversightControls";
import { PromptInput } from "./components/PromptInput";
import { RecentConversations } from "./components/RecentConversations";
import { SessionControls } from "./components/SessionControls";
import { SessionSidebar } from "./components/SessionSidebar";
import { StatusBar } from "./components/StatusBar";
import { TraceabilityInspector } from "./components/dev/TraceabilityInspector";
import { useAgentHistory } from "./hooks/useAgentHistory";
import { useChatSession, SESSION_STORAGE_KEY } from "./hooks/useChatSession";
import { useModels } from "./hooks/useModels";
import { useProjects } from "./hooks/useProjects";
import { useRecentConversations } from "./hooks/useRecentConversations";
import { toast } from "@/components/ui/toast";

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
      // Default replace keeps sync/ephemeral updates out of the stack.
      // Navigational transitions pass `{ history: "push" }` per call.
      { history: "replace" },
    );
  const setMobilePanel = useCallback(
    (next: MobilePanel) => {
      if (next === mobilePanel) return;
      void setUrlState({ tab: next }, { history: "push" });
    },
    [mobilePanel, setUrlState],
  );
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [devStatus, setDevStatus] = useState<DevStatus | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  /** Blocks URL auto-resume while clearing/switching sessions. */
  const suppressResumeRef = useRef(false);
  /** Dedupes URL→session resume when beginResume nulls session mid-effect. */
  const resumeTargetRef = useRef<string | null>(null);
  /** First paint may hydrate a session before ?agent= exists — stamp URL once. */
  const urlSyncReadyRef = useRef(false);

  const apiOk = health?.ok ?? false;
  const cursorReady = health?.cursor.ready ?? false;

  const {
    agents,
    loading: agentsLoading,
    busyId: historyBusyId,
    loadingMore: historyLoadingMore,
    hasMore: historyHasMore,
    loadMore: loadMoreHistory,
    searchServer: searchHistory,
    searchingServer: historySearchingServer,
    refresh: refreshAgents,
    unarchiveAgent: unarchiveHistoryAgent,
    deleteAgent: deleteHistoryAgent,
  } = useAgentHistory(project, { includeArchived: showArchived });

  const {
    agents: recentAgents,
    loading: recentLoading,
    busyId: recentBusyId,
    error: recentError,
    runningCount: recentRunningCount,
    loadingMore: recentLoadingMore,
    hasMore: recentHasMore,
    loadMore: loadMoreRecent,
    searchServer: searchRecent,
    searchingServer: recentSearchingServer,
    refresh: refreshRecent,
    markRead: markRecentRead,
    archiveAgent: archiveRecentAgent,
    unarchiveAgent: unarchiveRecentAgent,
    deleteAgent: deleteRecentAgent,
  } = useRecentConversations(projects, {
    live: mobilePanel === "recent",
    includeArchived: showArchived,
  });

  const {
    session,
    feed,
    runStatus,
    error,
    historyLoading,
    startSession,
    beginResume,
    resumeAgent,
    sendPrompt,
    stopRun,
    clearSession,
  } = useChatSession();

  const setProject = useCallback(
    (
      next: string,
      options?: { history?: "push" | "replace" },
    ) => {
      if (next === project) return;
      suppressResumeRef.current = true;
      resumeTargetRef.current = null;
      clearSession();
      void setUrlState(
        { project: next, agent: null },
        { history: options?.history ?? "push" },
      ).finally(() => {
        suppressResumeRef.current = false;
      });
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
      setProject(enabled[0].id, { history: "replace" });
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

  // URL is source of truth for the selected agent (supports browser back/forward).
  useEffect(() => {
    if (projectsLoading || suppressResumeRef.current) return;

    // Snapshot hydration can restore a session before the URL has ?agent=.
    // Stamp it in once so we don't treat that as "back to new chat".
    if (!urlSyncReadyRef.current) {
      urlSyncReadyRef.current = true;
      if (session?.agentId && !urlAgent) {
        setUrlAgent(session.agentId);
        resumeTargetRef.current = `${session.project ?? project}:${session.agentId}`;
        return;
      }
    }

    if (!urlAgent) {
      resumeTargetRef.current = null;
      // Back/forward (or New chat) cleared ?agent= — drop the live session.
      if (session) clearSession();
      return;
    }

    if (
      session?.agentId === urlAgent &&
      (!session.project || session.project === project)
    ) {
      resumeTargetRef.current = null;
      return;
    }

    const targetKey = `${project}:${urlAgent}`;
    if (resumeTargetRef.current === targetKey) return;
    resumeTargetRef.current = targetKey;

    let cancelled = false;
    const agentId = urlAgent;
    const projectId = project;
    void (async () => {
      try {
        beginResume(agentId, projectId);
        const resumed = await resumeAgent(agentId, projectId, selectedModel);
        if (cancelled) return;
        if (!resumed) {
          resumeTargetRef.current = null;
        }
      } catch {
        resumeTargetRef.current = null;
        if (!cancelled) setUrlAgent(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    projectsLoading,
    session,
    urlAgent,
    project,
    selectedModel,
    beginResume,
    resumeAgent,
    clearSession,
    setUrlAgent,
  ]);

  // One-shot migrate: old localStorage session → URL when no ?agent=.
  useEffect(() => {
    if (
      projectsLoading ||
      session ||
      urlAgent ||
      suppressResumeRef.current
    ) {
      return;
    }

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
    void refreshRecent();
  }, [session?.name, refreshAgents, refreshRecent]);

  useEffect(() => {
    // Stamp ?tab= when missing (deep links, first visit) so reload restores the panel.
    try {
      if (new URLSearchParams(window.location.search).has("tab")) return;
    } catch {
      return;
    }
    void setUrlState({ tab: mobilePanel }, { history: "replace" });
  }, [mobilePanel, setUrlState]);

  useEffect(() => {
    if (mobilePanel !== "recent") return;
    void refreshRecent();
  }, [mobilePanel, refreshRecent]);

  const handleNewSession = useCallback(async () => {
    suppressResumeRef.current = true;
    resumeTargetRef.current = null;
    clearSession();
    try {
      await setUrlState({ agent: null, tab: "feed" }, { history: "push" });
    } finally {
      suppressResumeRef.current = false;
    }
  }, [clearSession, setUrlState]);

  const handleResumeAgent = useCallback(
    async (agentId: string, projectId: string = project) => {
      void markRecentRead(agentId, projectId);
      if (session?.agentId === agentId && project === projectId) {
        setMobilePanel("feed");
        return;
      }
      suppressResumeRef.current = true;
      resumeTargetRef.current = `${projectId}:${agentId}`;
      beginResume(agentId, projectId);
      try {
        await setUrlState(
          {
            project: projectId,
            agent: agentId,
            tab: "feed",
          },
          { history: "push" },
        );
        await resumeAgent(agentId, projectId, selectedModel);
        void refreshAgents();
        void refreshRecent();
      } catch {
        resumeTargetRef.current = null;
        await setUrlState({ agent: null });
      } finally {
        suppressResumeRef.current = false;
      }
    },
    [
      session?.agentId,
      project,
      beginResume,
      setUrlState,
      setMobilePanel,
      resumeAgent,
      selectedModel,
      markRecentRead,
      refreshAgents,
      refreshRecent,
    ],
  );

  const handlePromptSend = useCallback(
    async (
      prompt: string,
      options: {
        includeDevLogs: boolean;
        allowOverlap?: boolean;
        images?: Array<{ data: string; mimeType: string; name?: string }>;
      },
    ) => {
      let active = session;
      if (!active) {
        suppressResumeRef.current = true;
        try {
          active = await startSession(project, selectedModel);
          // Replace so the new agent id doesn't stack an extra history entry
          // on top of New chat / empty feed.
          await setUrlState(
            { agent: active.agentId, tab: "feed" },
            { history: "replace" },
          );
          resumeTargetRef.current = `${project}:${active.agentId}`;
        } finally {
          suppressResumeRef.current = false;
        }
      } else {
        setMobilePanel("feed");
      }
      await sendPrompt(prompt, "manual", active, {
        includeDevLogs: options.includeDevLogs,
        allowOverlap: options.allowOverlap,
        images: options.images,
      });
      void refreshAgents();
      void refreshRecent();
    },
    [
      session,
      project,
      selectedModel,
      startSession,
      sendPrompt,
      refreshAgents,
      refreshRecent,
      setMobilePanel,
      setUrlState,
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
      ).catch(() => {
        // Error is already surfaced on the session feed.
      });
    },
    [handlePromptSend],
  );

  const handleUnarchiveAgent = useCallback(
    async (agentId: string, projectId: string = project) => {
      try {
        if (projectId === project) {
          await unarchiveHistoryAgent(agentId);
        } else {
          await unarchiveRecentAgent(agentId, projectId);
        }
        void refreshRecent();
        if (projectId === project) {
          void refreshAgents();
        }
      } catch (err) {
        console.error(err);
      }
    },
    [
      unarchiveHistoryAgent,
      unarchiveRecentAgent,
      refreshRecent,
      refreshAgents,
      project,
    ],
  );

  const handleArchiveAgent = useCallback(
    async (
      agentId: string,
      projectId: string = project,
      opts?: { goToRecent?: boolean },
    ) => {
      const fromHistory = agents.find((a) => a.agentId === agentId);
      const fromRecent = recentAgents.find((a) => a.agentId === agentId);
      const label =
        (session?.agentId === agentId ? session.name?.trim() : undefined) ||
        fromHistory?.name?.trim() ||
        fromRecent?.name?.trim() ||
        agentId.slice(0, 16);

      try {
        // Drop URL/session first so an in-flight resume can't recreate a
        // live session after archive closes the old ones.
        if (session?.agentId === agentId || urlAgent === agentId) {
          suppressResumeRef.current = true;
          resumeTargetRef.current = null;
          clearSession();
          try {
            await setUrlState(
              opts?.goToRecent
                ? { agent: null, tab: "recent" }
                : { agent: null },
              opts?.goToRecent ? { history: "push" } : undefined,
            );
          } catch {
            // Still archive even if URL sync fails.
          }
        } else if (opts?.goToRecent) {
          setMobilePanel("recent");
        }
        // Always update Recent local state (agents + live session overlay).
        // History is project-scoped and refreshed when it matches.
        await archiveRecentAgent(agentId, projectId);
        if (projectId === project) {
          void refreshAgents();
        }

        const toastId = toast.add({
          title: "Archived",
          description: `“${label}” moved out of History and Recent.`,
          timeout: 8000,
          actionProps: {
            children: "Undo",
            "aria-label": "Undo archive",
            onClick() {
              toast.close(toastId);
              void handleUnarchiveAgent(agentId, projectId);
            },
          },
        });
      } catch (err) {
        console.error(err);
      } finally {
        suppressResumeRef.current = false;
      }
    },
    [
      agents,
      recentAgents,
      archiveRecentAgent,
      refreshAgents,
      project,
      session,
      urlAgent,
      clearSession,
      setUrlState,
      setMobilePanel,
      handleUnarchiveAgent,
    ],
  );

  const handleDeleteAgent = useCallback(
    async (agentId: string, projectId: string = project) => {
      try {
        if (session?.agentId === agentId || urlAgent === agentId) {
          suppressResumeRef.current = true;
          resumeTargetRef.current = null;
          clearSession();
          try {
            await setUrlState({ agent: null });
          } catch {
            // Still delete even if URL sync fails.
          }
        }
        if (projectId === project) {
          await deleteHistoryAgent(agentId);
        } else {
          await deleteRecentAgent(agentId, projectId);
        }
        void refreshRecent();
        if (projectId === project) {
          void refreshAgents();
        }
      } catch (err) {
        console.error(err);
      } finally {
        suppressResumeRef.current = false;
      }
    },
    [
      deleteHistoryAgent,
      deleteRecentAgent,
      refreshRecent,
      refreshAgents,
      project,
      session,
      urlAgent,
      clearSession,
      setUrlState,
    ],
  );

  const running = runStatus === "running";
  const activeAgentId = session?.agentId ?? urlAgent;

  // Viewing a conversation counts as read (including when a run finishes while open).
  useEffect(() => {
    if (!session?.agentId || !session.project) return;
    if (mobilePanel === "recent") return;
    if (running) return;
    void markRecentRead(session.agentId, session.project);
  }, [
    session?.agentId,
    session?.project,
    mobilePanel,
    running,
    runStatus,
    markRecentRead,
  ]);

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
      <div
        className="shrink-0 border-t border-zinc-800/80 bg-zinc-950/95 backdrop-blur-xl"
        data-section="composer-dock"
        data-testid="composer-dock"
      >
        <SessionControls
          session={session}
          project={project}
          projects={projects}
          models={models}
          model={selectedModel}
          modelsLoading={modelsLoading}
          onProjectChange={setProject}
          onModelChange={selectModel}
        />
        <PromptInput
          disabled={!apiOk || !cursorReady}
          running={running}
          devStatus={devStatus}
          draftKey={`${project}:${activeAgentId ?? "new"}`}
          onSend={handlePromptSend}
        />
      </div>
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
        topic={topic}
        runStatus={runStatus}
        apiOk={apiOk}
        cursorReady={cursorReady}
        canArchive={Boolean(activeAgentId)}
        archiving={
          Boolean(activeAgentId) &&
          (historyBusyId === activeAgentId || recentBusyId === activeAgentId)
        }
        className={mobilePanel === "feed" ? "" : "hidden lg:block"}
        onNewSession={handleNewSession}
        onArchiveSession={() => {
          if (!activeAgentId) return;
          void handleArchiveAgent(
            activeAgentId,
            session?.project ?? project,
            { goToRecent: true },
          );
        }}
        onStop={() => void stopRun()}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SessionSidebar
          project={project}
          projects={projects}
          agents={agents}
          agentsLoading={agentsLoading}
          busyId={historyBusyId}
          activeAgentId={activeAgentId}
          showArchived={showArchived}
          loadingMore={historyLoadingMore}
          hasMore={historyHasMore}
          searchingServer={historySearchingServer}
          onProjectChange={setProject}
          onShowArchivedChange={setShowArchived}
          onLoadMore={loadMoreHistory}
          onSearchServer={searchHistory}
          onResumeAgent={(id) => void handleResumeAgent(id)}
          onArchiveAgent={(id) => void handleArchiveAgent(id)}
          onUnarchiveAgent={(id) => void handleUnarchiveAgent(id)}
          onDeleteAgent={(id) => void handleDeleteAgent(id)}
          className={
            mobilePanel === "history"
              ? "flex w-full min-w-0 lg:w-64"
              : "hidden lg:flex lg:w-64"
          }
        />

        <RecentConversations
          agents={recentAgents}
          agentsLoading={recentLoading}
          busyId={recentBusyId}
          activeAgentId={activeAgentId}
          error={recentError}
          showArchived={showArchived}
          loadingMore={recentLoadingMore}
          hasMore={recentHasMore}
          searchingServer={recentSearchingServer}
          onShowArchivedChange={setShowArchived}
          onLoadMore={loadMoreRecent}
          onSearchServer={searchRecent}
          onResumeAgent={(id, projectId) =>
            void handleResumeAgent(id, projectId)
          }
          onArchiveAgent={(id, projectId) =>
            void handleArchiveAgent(id, projectId)
          }
          onUnarchiveAgent={(id, projectId) =>
            void handleUnarchiveAgent(id, projectId)
          }
          onDeleteAgent={(id, projectId) =>
            void handleDeleteAgent(id, projectId)
          }
          className={
            mobilePanel === "recent" ? "flex lg:hidden" : "hidden"
          }
        />

        <main
          className={
            mobilePanel === "feed"
              ? "flex min-w-0 flex-1 flex-col overflow-hidden"
              : "hidden min-w-0 flex-1 flex-col overflow-hidden lg:flex"
          }
          aria-label="Conversation"
          data-component="ConversationPanel"
          data-testid="conversation-panel"
          data-section="conversation"
        >
          {conversationContent}
        </main>
      </div>

      <StatusBar
        session={session}
        runStatus={runStatus}
        apiOk={apiOk}
        cursorReady={cursorReady}
        bridgeVersion={health?.version}
        className="hidden lg:flex"
      />

      <MobileTabBar
        active={mobilePanel}
        onChange={setMobilePanel}
        runningCount={recentRunningCount}
      />
    </div>
  );
}
