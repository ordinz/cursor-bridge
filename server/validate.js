export const PROMPT_MAX_LENGTH = 100_000;

export class InvalidRequestError extends Error {
  constructor(message, code = "INVALID_REQUEST") {
    super(message);
    this.name = "InvalidRequestError";
    this.status = 400;
    this.code = code;
  }
}

export function validatePrompt(prompt) {
  if (prompt === undefined || prompt === null) {
    throw new InvalidRequestError("prompt is required");
  }
  if (typeof prompt !== "string") {
    throw new InvalidRequestError("prompt must be a string");
  }
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new InvalidRequestError("prompt must not be empty");
  }
  if (prompt.length > PROMPT_MAX_LENGTH) {
    throw new InvalidRequestError(
      `prompt exceeds maximum length of ${PROMPT_MAX_LENGTH} characters`,
      "PROMPT_TOO_LONG",
    );
  }
  return trimmed;
}

export function validateProjectId(project) {
  if (project === undefined || project === null || project === "") {
    throw new InvalidRequestError("project is required");
  }
  if (typeof project !== "string") {
    throw new InvalidRequestError("project must be a string");
  }
  if (project.includes("..") || project.includes("/") || project.includes("\\")) {
    throw new InvalidRequestError(`unknown project: ${project}`, "UNKNOWN_PROJECT");
  }
  return project.trim();
}

export function validateSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== "string") {
    throw new InvalidRequestError("session id is required");
  }
  return sessionId;
}
