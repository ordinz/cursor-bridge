import fs from "fs";
import path from "path";

export const PROJECTS_ROOT = path.resolve(
  process.env.PROJECTS_ROOT ?? path.join(process.env.HOME, "dev/mx/https"),
);

export const ENABLED_PROJECT_IDS = (
  process.env.ENABLED_PROJECTS ?? "www,app,admin,email,cursor-bridge"
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

/**
 * Optional absolute path overrides: `id:/abs/path,id2:/abs/path`
 * Used for repos that do not live under PROJECTS_ROOT (e.g. cursor-bridge).
 */
export function parseProjectPathOverrides(raw = process.env.PROJECT_PATH_OVERRIDES) {
  const map = {};
  if (!raw?.trim()) {
    // Sensible default for local cursor-bridge checkout
    const bridgeDefault = path.join(process.env.HOME || "", "dev/cursor-bridge");
    if (fs.existsSync(bridgeDefault)) {
      map["cursor-bridge"] = bridgeDefault;
    }
    return map;
  }
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const id = trimmed.slice(0, colon).trim();
    const abs = trimmed.slice(colon + 1).trim();
    if (!id || !abs) continue;
    map[id] = path.resolve(abs);
  }
  return map;
}

const PATH_OVERRIDES = parseProjectPathOverrides();

function projectDir(projectId) {
  if (PATH_OVERRIDES[projectId]) return PATH_OVERRIDES[projectId];
  return path.resolve(PROJECTS_ROOT, projectId);
}

function isWithinRoot(resolved) {
  return (
    resolved === PROJECTS_ROOT ||
    resolved.startsWith(PROJECTS_ROOT + path.sep)
  );
}

function isAllowedPath(projectId, resolved) {
  if (PATH_OVERRIDES[projectId] && path.resolve(PATH_OVERRIDES[projectId]) === resolved) {
    return true;
  }
  return isWithinRoot(resolved);
}

export function isProjectEnabled(projectId) {
  return ENABLED_PROJECT_IDS.includes(projectId);
}

/** Only enabled allowlist entries that exist on disk. */
export function listProjects() {
  return ENABLED_PROJECT_IDS.map((id) => {
    const resolved = projectDir(id);
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

  const resolved = projectDir(projectId);

  if (!isAllowedPath(projectId, resolved)) {
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
