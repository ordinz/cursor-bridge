import { createSseEvent } from "./sse-events.js";

export const HEARTBEAT_INTERVAL_MS = 15_000;

export function setupSse(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

export function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function writeHeartbeat(res) {
  res.write(": heartbeat\n\n");
}

export function serializeSdkEvent(event, sessionId) {
  switch (event.type) {
    case "assistant":
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) {
          return createSseEvent("assistant", sessionId, { text: block.text });
        }
      }
      return null;
    case "tool_call": {
      const fields = {
        callId: event.call_id,
        name: event.name,
        status: event.status,
        args: event.args,
      };

      if (event.status === "running") {
        return createSseEvent("tool_call", sessionId, fields);
      }

      if (event.status === "completed" || event.status === "error") {
        return createSseEvent("tool_result", sessionId, {
          callId: event.call_id,
          name: event.name,
          status: event.status,
          result: event.result,
          truncated: event.truncated,
        });
      }

      return createSseEvent("tool_call", sessionId, {
        ...fields,
        result: event.result,
        truncated: event.truncated,
      });
    }
    case "status":
      return createSseEvent("status", sessionId, {
        status: event.status,
        message: event.message,
      });
    case "user": {
      const text = event.message.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      return text
        ? createSseEvent("user", sessionId, { text, source: "agent" })
        : null;
    }
    case "thinking":
      return createSseEvent("thinking", sessionId, { text: event.text });
    case "system":
      return createSseEvent("system", sessionId, {
        subtype: event.subtype,
        agentId: event.agent_id,
        runId: event.run_id,
      });
    default:
      return null;
  }
}

export function startHeartbeat(res, intervalMs = HEARTBEAT_INTERVAL_MS) {
  const timer = setInterval(() => {
    if (!res.writableEnded) {
      writeHeartbeat(res);
    }
  }, intervalMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return timer;
}

/**
 * Stream SDK run events over SSE.
 * - Emits `: heartbeat` comments every 15s
 * - On success: exactly one `done` event
 * - On failure: one `error` event (no `done`)
 * - On cancel: `status` + one `done` with status cancelled
 */
export async function streamRun(
  res,
  run,
  { sessionId, onEvent, signal, publish } = {},
) {
  const heartbeat = startHeartbeat(res);
  let doneEmitted = false;
  let errorEmitted = false;

  const emit = (payload) => {
    if (!payload) return;
    onEvent?.(payload);
    if (publish) {
      publish(payload);
    } else if (!res.writableEnded) {
      writeSse(res, payload);
    }
  };

  const emitDone = (fields) => {
    if (doneEmitted || errorEmitted) return null;
    doneEmitted = true;
    const done = createSseEvent("done", sessionId, fields);
    emit(done);
    return done;
  };

  const emitError = (message, code = "RUN_FAILED") => {
    if (doneEmitted || errorEmitted) return null;
    errorEmitted = true;
    emit(createSseEvent("error", sessionId, { message, code }));
    return true;
  };

  try {
    for await (const event of run.stream()) {
      if (signal?.aborted) {
        if (run.supports?.("cancel")) {
          await run.cancel();
        }
        break;
      }

      emit(serializeSdkEvent(event, sessionId));
    }

    if (signal?.aborted) {
      emit(
        createSseEvent("status", sessionId, {
          status: "CANCELLED",
          message: "Run cancelled",
        }),
      );
      return {
        result: { id: null, status: "cancelled" },
        done: emitDone({ runId: null, status: "cancelled" }),
        cancelled: true,
      };
    }

    const result = await run.wait();

    if (result.status === "cancelled") {
      emit(
        createSseEvent("status", sessionId, {
          status: "CANCELLED",
          message: "Run cancelled",
        }),
      );
      return {
        result,
        done: emitDone({ runId: result.id, status: "cancelled" }),
        cancelled: true,
      };
    }

    if (result.status === "error") {
      emitError("Run finished with error", "RUN_FAILED");
      return { result, done: null, failed: true };
    }

    return {
      result,
      done: emitDone({ runId: result.id, status: result.status }),
    };
  } catch (err) {
    emitError(err.message ?? "Run failed", "RUN_FAILED");
    return { result: null, done: null, failed: true };
  } finally {
    clearInterval(heartbeat);
  }
}
