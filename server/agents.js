import { createAgentPlatform, SqliteLocalAgentStore } from "@cursor/sdk";
import { resolveProject } from "./projects.js";
import { nameFromPrompt } from "./agent-names.js";

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

export async function updateLocalAgentName(agentId, project, prompt) {
  const cwd = resolveProject(project);
  const name = nameFromPrompt(prompt);
  const store = await SqliteLocalAgentStore.open({ workspaceRef: cwd });

  try {
    const doc = await store.agents.get({ agentId });
    if (!doc) return name;

    await store.agents.update({
      agent: {
        ...doc,
        name,
        updatedAt: Date.now(),
        sdkMetadata: { ...doc.sdkMetadata, namedFromPrompt: true },
      },
    });

    return name;
  } finally {
    await store.dispose();
  }
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
