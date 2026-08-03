export const TITLE_MAX = 72;

/** Distinctive name for one-shot agents that only generate conversation titles. */
export const BRIDGE_NAMING_AGENT_NAME = "cursor-bridge · naming";

/** Pre-marker default from `Agent.prompt()` naming helpers. */
const LEGACY_NAMING_AGENT_NAME = "New Agent";

/**
 * Hide ephemeral title-generation agents from bridge UI / Telegram / MCP lists.
 * @param {{ name?: string | null }} agent
 */
export function isBridgeNamingAgent(agent) {
  const name = typeof agent?.name === "string" ? agent.name.trim() : "";
  return (
    name === BRIDGE_NAMING_AGENT_NAME || name === LEGACY_NAMING_AGENT_NAME
  );
}

export function modelLabel(modelId) {
  if (!modelId || modelId === "default") return "Auto";
  return modelId;
}

export function nameFromPrompt(prompt) {
  const line =
    prompt
      .trim()
      .split(/\r?\n/)
      .find((l) => l.trim()) ?? prompt.trim();
  const collapsed = line.replace(/\s+/g, " ").trim();
  if (!collapsed) return "Untitled";
  if (collapsed.length <= TITLE_MAX) return collapsed;
  return `${collapsed.slice(0, TITLE_MAX - 3)}…`;
}

export function buildAgentName({ project, model, prompt }) {
  if (prompt) {
    return nameFromPrompt(prompt);
  }

  const time = new Date().toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return `${project} · ${modelLabel(model)} · ${time}`;
}

export function buildNamingPrompt({ prompt, assistantSnippet }) {
  const lines = [
    "Generate a short title (3–6 words) for this coding agent conversation.",
    "Reply with ONLY the title — no quotes, no trailing punctuation, no explanation.",
    "",
    "User task:",
    prompt.trim(),
  ];

  if (assistantSnippet?.trim()) {
    lines.push("", "Agent response (excerpt):", assistantSnippet.trim());
  }

  return lines.join("\n");
}

export function sanitizeGeneratedName(text) {
  const line =
    text
      .trim()
      .split(/\r?\n/)
      .find((l) => l.trim()) ?? text.trim();

  let cleaned = line
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^title:\s*/i, "")
    .replace(/\*\*/g, "")
    .replace(/[.!?]+$/, "")
    .trim()
    .replace(/\s+/g, " ");

  if (!cleaned) return null;
  if (cleaned.length <= TITLE_MAX) return cleaned;
  return `${cleaned.slice(0, TITLE_MAX - 3)}…`;
}
