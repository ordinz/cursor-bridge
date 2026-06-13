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

export async function deleteLocalAgent(agentId, project) {
  const cwd = resolveProject(project);
  const platform = await createAgentPlatform({ workspaceRef: cwd });

  const runs = await platform.listRuns(agentId, { limit: 100 });
  for (const run of runs.items) {
    if (run.status === "running") {
      if (run.supports("cancel")) {
        await run.cancel();
      } else {
        await platform.cancelRun(run.id);
      }
    }
  }

  await platform.deleteAgent(agentId);
}
