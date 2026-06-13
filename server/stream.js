export function setupSse(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

export function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function serializeSdkEvent(event) {
  switch (event.type) {
    case "assistant":
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) {
          return { type: "assistant", text: block.text };
        }
      }
      return null;
    case "tool_call":
      return {
        type: "tool_call",
        callId: event.call_id,
        name: event.name,
        status: event.status,
        args: event.args,
        result: event.result,
        truncated: event.truncated,
      };
    case "status":
      return {
        type: "status",
        status: event.status,
        message: event.message,
      };
    case "user": {
      const text = event.message.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      return text ? { type: "user", text } : null;
    }
    case "thinking":
      return { type: "thinking", text: event.text };
    case "system":
      return {
        type: "system",
        subtype: event.subtype,
        agentId: event.agent_id,
        runId: event.run_id,
      };
    default:
      return null;
  }
}

export async function streamRun(res, run, extras = {}) {
  for await (const event of run.stream()) {
    const payload = serializeSdkEvent(event);
    if (payload) {
      writeSse(res, payload);
    }
  }

  const result = await run.wait();
  writeSse(res, {
    type: "done",
    runId: result.id,
    status: result.status,
    ...extras,
  });
  return result;
}
