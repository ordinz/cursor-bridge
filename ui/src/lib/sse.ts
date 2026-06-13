import type { SseEvent } from "./types";

export async function* readSseStream(
  response: Response,
): AsyncGenerator<SseEvent> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            yield JSON.parse(line.slice(6)) as SseEvent;
          } catch {
            // skip malformed
          }
        }
      }
    }
  }
}

export async function postChat(
  sessionId: string,
  prompt: string,
): Promise<Response> {
  const res = await fetch(`/api/sessions/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? res.statusText);
  }

  return res;
}
