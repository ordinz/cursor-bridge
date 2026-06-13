import fs from "fs";
import path from "path";

export const PROJECTS_ROOT = path.resolve(
  process.env.PROJECTS_ROOT ?? path.join(process.env.HOME, "dev/mx/https"),
);

export const ENABLED_PROJECT_IDS = (
  process.env.ENABLED_PROJECTS ?? "www,app"
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

function isWithinRoot(resolved) {
  return (
    resolved === PROJECTS_ROOT ||
    resolved.startsWith(PROJECTS_ROOT + path.sep)
  );
}

export function isProjectEnabled(projectId) {
  return ENABLED_PROJECT_IDS.includes(projectId);
}

/** Only enabled allowlist entries that exist on disk. */
export function listProjects() {
  if (!fs.existsSync(PROJECTS_ROOT)) {
    return [];
  }

  return ENABLED_PROJECT_IDS.map((id) => {
    const resolved = path.resolve(PROJECTS_ROOT, id);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return null;
    }
    return {
      id,
      name: id,
      path: resolved,
      enabled: true,
    };
  }).filter(Boolean);
}

export function resolveProject(projectId, { requireEnabled = true } = {}) {
  if (!projectId || typeof projectId !== "string") {
    throw new ProjectError("project is required", 400);
  }

  if (projectId.includes("..") || path.isAbsolute(projectId)) {
    throw new ProjectError("invalid project id", 400);
  }

  if (!ENABLED_PROJECT_IDS.includes(projectId)) {
    throw new ProjectError(`unknown project: ${projectId}`, 400);
  }

  if (requireEnabled && !isProjectEnabled(projectId)) {
    throw new ProjectError(
      `project is disabled: ${projectId}`,
      403,
      "PROJECT_DISABLED",
    );
  }

  const resolved = path.resolve(PROJECTS_ROOT, projectId);

  if (!isWithinRoot(resolved)) {
    throw new ProjectError("project outside allowlist", 400);
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new ProjectError(`unknown project: ${projectId}`, 400);
  }

  return resolved;
}

export class ProjectError extends Error {
  constructor(message, status = 400, code = "UNKNOWN_PROJECT") {
    super(message);
    this.name = "ProjectError";
    this.status = status;
    this.code = code;
  }
}
