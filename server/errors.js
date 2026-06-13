export class SessionBusyError extends Error {
  constructor(sessionId) {
    super(`Session already has an active run: ${sessionId}`);
    this.name = "SessionBusyError";
    this.status = 409;
    this.code = "SESSION_BUSY";
    this.sessionId = sessionId;
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionId) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
    this.status = 404;
    this.code = "SESSION_NOT_FOUND";
    this.sessionId = sessionId;
  }
}

export class NoActiveRunError extends Error {
  constructor(sessionId) {
    super(`No active run on session: ${sessionId}`);
    this.name = "NoActiveRunError";
    this.status = 409;
    this.code = "NO_ACTIVE_RUN";
    this.sessionId = sessionId;
  }
}

export function errorBody(err, extra = {}) {
  return {
    error: err.message,
    code: err.code ?? "INTERNAL_ERROR",
    ...extra,
  };
}
