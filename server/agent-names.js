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
  if (collapsed.length <= 72) return collapsed;
  return `${collapsed.slice(0, 69)}…`;
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
