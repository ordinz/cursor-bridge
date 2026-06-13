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

export function listProjects() {
  if (!fs.existsSync(PROJECTS_ROOT)) {
    return [];
  }

  const projects = fs
    .readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const resolved = path.resolve(PROJECTS_ROOT, entry.name);
      const enabled = isProjectEnabled(entry.name);
      return {
        id: entry.name,
        name: entry.name,
        path: resolved,
        enabled,
      };
    });

  return projects.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    const aIdx = ENABLED_PROJECT_IDS.indexOf(a.id);
    const bIdx = ENABLED_PROJECT_IDS.indexOf(b.id);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.id.localeCompare(b.id);
  });
}

export function resolveProject(projectId, { requireEnabled = true } = {}) {
  if (!projectId || typeof projectId !== "string") {
    throw new ProjectError("project is required", 400);
  }

  if (projectId.includes("..") || path.isAbsolute(projectId)) {
    throw new ProjectError("invalid project id", 400);
  }

  const resolved = path.resolve(PROJECTS_ROOT, projectId);

  if (!isWithinRoot(resolved)) {
    throw new ProjectError("project outside allowlist", 400);
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new ProjectError(`unknown project: ${projectId}`, 400);
  }

  const allowed = listProjects();
  if (!allowed.some((p) => p.id === projectId)) {
    throw new ProjectError(`unknown project: ${projectId}`, 400);
  }

  if (requireEnabled && !isProjectEnabled(projectId)) {
    throw new ProjectError(`project is disabled: ${projectId}`, 403);
  }

  return resolved;
}

export class ProjectError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ProjectError";
    this.status = status;
  }
}
