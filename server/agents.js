import { Agent, createAgentPlatform, SqliteLocalAgentStore } from "@cursor/sdk";
import { resolveProject } from "./projects.js";
import {
  buildNamingPrompt,
  nameFromPrompt,
  sanitizeGeneratedName,
} from "./agent-names.js";
import { createSseEvent } from "./sse-events.js";

export async function getLocalAgentMeta(agentId, project) {
  const cwd = resolveProject(project);
  const store = await SqliteLocalAgentStore.open({ workspaceRef: cwd });

  try {
    const doc = await store.agents.get({ agentId });
    if (!doc) return { name: null, namedFromPrompt: false };

    return {
      name: doc.name ?? null,
      namedFromPrompt: Boolean(doc.sdkMetadata?.namedFromPrompt),
    };
  } finally {
    await store.dispose();
  }
}

export async function setLocalAgentName(
  agentId,
  project,
  name,
  { namedFromPrompt = true } = {},
) {
  const cwd = resolveProject(project);
  const store = await SqliteLocalAgentStore.open({ workspaceRef: cwd });

  try {
    const doc = await store.agents.get({ agentId });
    if (!doc) return name;

    await store.agents.update({
      agent: {
        ...doc,
        name,
        updatedAt: Date.now(),
        sdkMetadata: { ...doc.sdkMetadata, namedFromPrompt },
      },
    });

    return name;
  } finally {
    await store.dispose();
  }
}

export async function updateLocalAgentName(agentId, project, prompt) {
  return setLocalAgentName(agentId, project, nameFromPrompt(prompt));
}

export async function generateAgentNameWithLlm({
  prompt,
  assistantSnippet,
  cwd,
}) {
  const model = process.env.AGENT_NAMING_MODEL ?? "default";
  const metaPrompt = buildNamingPrompt({ prompt, assistantSnippet });

  try {
    const result = await Agent.prompt(metaPrompt, {
      apiKey: process.env.CURSOR_API_KEY,
      model: { id: model },
      local: { cwd },
    });

    if (result.status !== "finished") return null;

    const raw =
      typeof result.result === "string"
        ? result.result
        : result.result?.text ?? null;

    if (!raw) return null;
    return sanitizeGeneratedName(raw);
  } catch {
    return null;
  }
}

export async function finalizeAgentName({
  sessions,
  sessionId,
  agentId,
  project,
  cwd,
  prompt,
  assistantSnippet,
}) {
  let name;
  try {
    name = await generateAgentNameWithLlm({
      prompt,
      assistantSnippet,
      cwd,
    });
  } catch {
    name = null;
  }
  if (!name) {
    name = nameFromPrompt(prompt);
  }

  try {
    await setLocalAgentName(agentId, project, name);
  } catch {
    // Session record still gets the generated name for in-memory clients.
  }

  sessions.markNamedFromPrompt(sessionId, name);

  const record = sessions.get(sessionId);
  if (!record) return name;

  try {
    const { renameAgentTelegramTopic } = await import("./telegram-topics.js");
    await renameAgentTelegramTopic(sessionId, project, name);
  } catch {
    /* telegram optional */
  }

  sessions.publishEvent(
    sessionId,
    createSseEvent("session", sessionId, {
      agentId,
      project: record.project,
      cwd: record.cwd,
      name,
      runStatus: record.runStatus,
      runActive: Boolean(record.activeRun),
    }),
  );

  return name;
}

/**
 * Cancel Cursor-side runs still marked running (e.g. bridge lost track after restart).
 * @returns {Promise<number>} count cancelled
 */
export async function cancelStaleAgentRuns(agentId, cwd) {
  const platform = await createAgentPlatform({ workspaceRef: cwd });
  const runs = await platform.listRuns(agentId, { limit: 20 });
  let cancelled = 0;

  for (const run of runs.items) {
    if (run.status !== "running") continue;
    try {
      if (run.supports?.("cancel")) {
        await run.cancel();
      } else {
        await platform.cancelRun(run.id);
      }
      cancelled++;
    } catch {
      // ignore per-run cancel failures
    }
  }

  return cancelled;
}

export function isAgentBusyError(err) {
  const msg = err instanceof Error ? err.message : String(err || "");
  return /already has (?:an )?active run/i.test(msg);
}

/**
 * agent.send with one retry after clearing stale Cursor runs.
 * Matches Telegram operator behavior so the UI doesn't surface ghost "busy" errors.
 */
export async function sendAgentMessage(agent, sendMessage, opts, meta = {}) {
  try {
    return opts === undefined
      ? await agent.send(sendMessage)
      : await agent.send(sendMessage, opts);
  } catch (err) {
    if (!isAgentBusyError(err)) throw err;
    const { agentId, cwd } = meta;
    if (!agentId || !cwd) throw err;
    const cleared = await cancelStaleAgentRuns(agentId, cwd);
    if (cleared <= 0) throw err;
    return opts === undefined
      ? await agent.send(sendMessage)
      : await agent.send(sendMessage, opts);
  }
}

export async function deleteLocalAgent(agentId, project) {
  const cwd = resolveProject(project);
  await cancelStaleAgentRuns(agentId, cwd);

  const platform = await createAgentPlatform({ workspaceRef: cwd });
  await platform.deleteAgent(agentId);
}
