import { Agent } from "@cursor/sdk";
import { resolveProject } from "./projects.js";

function getConversationTurn(message) {
  if (!message) return null;
  if (message.agentConversationTurn) return message.agentConversationTurn;
  if (message.turn?.case === "agentConversationTurn") return message.turn.value;
  if (message.turn?.userMessage || message.turn?.steps) return message.turn;
  return null;
}

function unwrapStep(step) {
  if (!step) return null;
  if (step.assistantMessage || step.toolCall) return step;
  if (step.message?.case === "assistantMessage") {
    return { assistantMessage: step.message.value };
  }
  if (step.message?.case === "toolCall") {
    return { toolCall: step.message.value };
  }
  return step;
}

function toolFromStep(step) {
  const normalized = unwrapStep(step);
  const toolCall = normalized?.toolCall;
  if (!toolCall) return null;

  let inner = toolCall;
  let name = "tool";

  if (toolCall.tool) {
    const tool = toolCall.tool;
    if (tool.case?.endsWith("ToolCall")) {
      name = tool.case.replace(/ToolCall$/, "");
      inner = tool.value;
    } else {
      const key = Object.keys(tool).find((k) => k.endsWith("ToolCall"));
      if (key) {
        inner = tool[key];
        name = key.replace(/ToolCall$/, "");
      }
    }
  } else {
    const key = Object.keys(toolCall).find((k) => k.endsWith("ToolCall"));
    if (key) {
      inner = toolCall[key];
      name = key.replace(/ToolCall$/, "");
    }
  }

  const callId =
    toolCall.toolCallId ??
    `${name}-${Math.random().toString(36).slice(2)}`;

  return {
    id: callId,
    kind: "tool",
    callId,
    name: name.charAt(0).toLowerCase() + name.slice(1),
    status: "completed",
    args: inner?.args,
    result: inner?.result,
  };
}

function textFromAssistantStep(step) {
  const normalized = unwrapStep(step);
  return normalized?.assistantMessage?.text ?? "";
}

export function messagesToFeedItems(messages) {
  const items = [];
  let assistantBuffer = "";

  function flushAssistant() {
    const text = assistantBuffer.trim();
    if (!text) return;
    items.push({
      id: `assistant-${items.length}`,
      kind: "assistant",
      text: assistantBuffer,
    });
    assistantBuffer = "";
  }

  for (const msg of messages) {
    const turn = getConversationTurn(msg.message);
    if (!turn) continue;

    flushAssistant();

    const userText = turn.userMessage?.text?.trim();
    if (userText) {
      items.push({
        id: msg.uuid ?? `user-${items.length}`,
        kind: "user",
        text: userText,
        source: "history",
      });
    }

    for (const step of turn.steps ?? []) {
      const tool = toolFromStep(step);
      if (tool) {
        flushAssistant();
        items.push(tool);
        continue;
      }

      const chunk = textFromAssistantStep(step);
      if (chunk) {
        assistantBuffer += chunk;
      }
    }

    flushAssistant();
  }

  return items;
}

export async function loadAgentHistory(agentId, project) {
  const cwd = resolveProject(project);
  const messages = await Agent.messages.list(agentId, {
    runtime: "local",
    cwd,
  });

  return messagesToFeedItems(messages);
}
