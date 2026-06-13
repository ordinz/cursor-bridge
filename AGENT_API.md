# Cursor Bridge — Agent Client API

Localhost-first HTTP + SSE API for external browser agents (Comet, Perplexity Computer, custom scripts).

**Base URL:** `http://127.0.0.1:4242/api`

Do not expose this bridge publicly. It runs Cursor agents with filesystem access using your local API key.

**Machine-readable spec:** `GET /api/openapi.json` (OpenAPI 3.1)

**Browser example:** `examples/browser-client.html` — open at `http://127.0.0.1:4242/examples/browser-client.html` when running `pnpm start -- --prod`

---

## Quick start

```bash
# 1. Check bridge + Cursor connectivity
curl -s http://127.0.0.1:4242/api/health | jq

# 2. List allowed projects
curl -s http://127.0.0.1:4242/api/projects | jq

# 3. Create a session
curl -s -X POST http://127.0.0.1:4242/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"project":"app","model":"default"}' | jq

# 4. Send a prompt (SSE stream)
curl -N -X POST http://127.0.0.1:4242/api/sessions/<sessionId>/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Summarize this repo in one sentence"}'
```

---

## REST routes

### `GET /api/health`

Bridge status and Cursor connectivity probe.

```json
{
  "ok": true,
  "version": "1.0.0",
  "bridge": { "status": "up", "host": "127.0.0.1", "port": 4242 },
  "cursor": {
    "apiKeyConfigured": true,
    "ready": true,
    "reason": null
  }
}
```

Wait until `cursor.ready === true` before creating sessions.

---

### `GET /api/projects`

Returns only the enabled allowlist (`www`, `app` by default). Other directories under the workspace root are not exposed.

```json
{
  "projects": [
    { "id": "www", "name": "www", "canCreateSession": true },
    { "id": "app", "name": "app", "canCreateSession": true }
  ]
}
```

Configure allowlist via `ENABLED_PROJECTS` (default `www,app`).

---

### `POST /api/sessions`

```json
{ "project": "app", "model": "default" }
```

**201 response:**

```json
{
  "sessionId": "uuid",
  "agentId": "agent-…",
  "project": "app",
  "cwd": "/path/to/app",
  "model": "default",
  "name": "app · Auto · …",
  "runStatus": "idle",
  "runActive": false,
  "createdAt": 1710000000000,
  "lastActivityAt": 1710000000000,
  "lastPrompt": null,
  "lastAssistantSnippet": null,
  "namedFromPrompt": false
}
```

---

### `GET /api/sessions/:id`

Returns the same shape as create/resume. Use this to poll session state between turns.

---

### `POST /api/sessions/:id/chat`

**Request:**

```json
{ "prompt": "Fix the login bug", "allowOverlap": false }
```

| Field | Default | Description |
|-------|---------|-------------|
| `prompt` | required | User/agent message (1–100,000 chars, non-empty after trim) |
| `allowOverlap` | `false` | If `false`, returns **409** when a run is already active |

**400 response (invalid prompt):**

```json
{
  "error": "prompt must not be empty",
  "code": "INVALID_REQUEST"
}
```

**409 response (session busy):**

```json
{
  "error": "Session already has an active run: <sessionId>",
  "code": "SESSION_BUSY",
  "sessionId": "<sessionId>"
}
```

**Response:** `text/event-stream` — see SSE schema below.

---

### `POST /api/sessions/:id/cancel`

Cancel the active run. Returns **409 `NO_ACTIVE_RUN`** if the session exists but is idle.

```json
{ "ok": true, "sessionId": "…", "runStatus": "cancelled" }
```

When a chat SSE stream is open, cancellation also aborts the stream and emits `status` + `done` with `status: "cancelled"`.

---

### `DELETE /api/sessions/:id`

Cancel any active run and close the session.

---

### `POST /api/sessions/resume`

Resume a persisted agent by ID:

```json
{ "agentId": "agent-…", "project": "app", "model": "default" }
```

---

## SSE event schema

Every event is a JSON object on a `data:` line with these **base fields**:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Event kind (see below) |
| `sessionId` | string \| null | Bridge session ID |
| `timestamp` | string | ISO-8601 UTC |

**Keep-alive:** During long runs the server sends SSE comment lines every 15 seconds:

```
: heartbeat
```

Clients should ignore lines starting with `:`.

### Event types

#### `session`

Emitted at the start of each chat turn.

```json
{
  "type": "session",
  "sessionId": "…",
  "timestamp": "2026-06-13T12:00:00.000Z",
  "agentId": "agent-…",
  "project": "app",
  "cwd": "/path/to/app",
  "name": "Fix the login bug",
  "runStatus": "running",
  "runActive": true
}
```

#### `status`

```json
{
  "type": "status",
  "sessionId": "…",
  "timestamp": "…",
  "status": "RUNNING",
  "message": "Run started"
}
```

#### `user`

```json
{
  "type": "user",
  "sessionId": "…",
  "timestamp": "…",
  "text": "Fix the login bug",
  "source": "api"
}
```

#### `assistant`

Streaming **text deltas** — concatenate all `assistant` events in a turn to rebuild the full reply. Each event carries a partial `text` string, not the full message.

```json
{
  "type": "assistant",
  "sessionId": "…",
  "timestamp": "…",
  "text": "partial "
}
```

#### `tool_call`

Tool invocation started.

```json
{
  "type": "tool_call",
  "sessionId": "…",
  "timestamp": "…",
  "callId": "tool_…",
  "name": "read",
  "status": "running",
  "args": { "path": "src/App.tsx" }
}
```

#### `tool_result`

Tool completed (separate from `tool_call`).

```json
{
  "type": "tool_result",
  "sessionId": "…",
  "timestamp": "…",
  "callId": "tool_…",
  "name": "read",
  "status": "completed",
  "result": { "success": { "content": "…" } },
  "truncated": false
}
```

#### `error`

```json
{
  "type": "error",
  "sessionId": "…",
  "timestamp": "…",
  "message": "Run failed",
  "code": "RUN_FAILED"
}
```

#### `done`

Run finished successfully or was cancelled — **exactly one** `done` per successful/cancelled stream. Not emitted after `error`.

```json
{
  "type": "done",
  "sessionId": "…",
  "timestamp": "…",
  "runId": "run-…",
  "status": "finished"
}
```

`status` may be `finished` or `cancelled`.

---

## Browser SSE example (`fetch` + `ReadableStream`)

```javascript
async function chat(sessionId, prompt) {
  const res = await fetch(
    `http://127.0.0.1:4242/api/sessions/${sessionId}/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    },
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`${err.code}: ${err.error}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assistantText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6));
        console.log(event.type, event);

        if (event.type === "assistant") {
          assistantText += event.text;
        }
        if (event.type === "done") {
          return { status: event.status, text: assistantText };
        }
        if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    }
  }
}
```

---

## Recommended client loop

1. `GET /api/health` — wait for `cursor.ready`
2. `GET /api/projects` — pick an enabled project
3. `POST /api/sessions` — store `sessionId`
4. Loop:
   - `POST /api/sessions/:id/chat` — consume SSE until `done` (success/cancel) or `error` (failure)
   - Concatenate `assistant` deltas into the full reply
   - On **409** `SESSION_BUSY`: poll `GET /api/sessions/:id` until `runActive: false`, then retry
   - On **404**: session expired — create a new one or resume agent
5. `POST /api/sessions/:id/cancel` — stop an in-flight run (optional; also ends open SSE with `done`/`cancelled`)
6. `DELETE /api/sessions/:id` — cleanup when finished

---

## Error codes

| Code | HTTP | Meaning |
|------|------|---------|
| `SESSION_BUSY` | 409 | Run already active on this session |
| `NO_ACTIVE_RUN` | 409 | Cancel called while session is idle |
| `SESSION_NOT_FOUND` | 404 | Unknown or expired session |
| `INVALID_REQUEST` | 400 | Missing/invalid body or query param |
| `PROMPT_TOO_LONG` | 400 | Prompt exceeds 100,000 characters |
| `UNKNOWN_PROJECT` | 400 | Unknown or malformed project id |
| `PROJECT_DISABLED` | 403 | Project listed but not enabled |
| `RUN_FAILED` | SSE | Cursor run threw during streaming |

---

## TypeScript types

Shared types live in [`shared/api-types.ts`](./shared/api-types.ts) for UI and external TS clients.

---

## Legacy one-shot

`POST /prompt` with `{ prompt, project, model }` creates an ephemeral agent, streams once, and closes. Prefer the session API for multi-turn agents.
