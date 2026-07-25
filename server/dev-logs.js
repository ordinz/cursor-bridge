import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { resolveProject } from "./projects.js";

const MAX_BUFFER_LINES = 500;
const MAX_BUFFER_BYTES = 128 * 1024;
const FILE_STALE_MS = 2 * 60 * 60 * 1000;

export function getDevLogsDir() {
  return path.resolve(
    process.env.CURSOR_BRIDGE_DEV_LOGS_DIR ??
      path.join(os.homedir(), ".cursor-bridge", "dev-logs"),
  );
}

/** @deprecated use getDevLogsDir() */
export const DEV_LOGS_DIR = getDevLogsDir();

/** @type {Record<string, { port: number }>} */
const DEFAULT_DEV_CONFIG = {
  app: { port: 3000 },
  www: { port: 3001 },
};

class RingBuffer {
  /** @param {number} maxLines @param {number} maxBytes */
  constructor(maxLines, maxBytes) {
    this.maxLines = maxLines;
    this.maxBytes = maxBytes;
    /** @type {string[]} */
    this.lines = [];
    this.totalBytes = 0;
  }

  /** @param {string} line */
  push(line) {
    const trimmed = line.replace(/\r?\n$/, "");
    if (!trimmed) return;

    const stamped = `[${new Date().toISOString()}] ${trimmed}`;
    this.lines.push(stamped);
    this.totalBytes += Buffer.byteLength(stamped, "utf8");

    while (
      this.lines.length > this.maxLines ||
      this.totalBytes > this.maxBytes
    ) {
      const removed = this.lines.shift();
      if (removed) {
        this.totalBytes -= Buffer.byteLength(removed, "utf8");
      }
    }
  }

  /** @param {number} [count] */
  tail(count = this.lines.length) {
    return this.lines.slice(-count);
  }

  get lineCount() {
    return this.lines.length;
  }
}

/** @type {Map<string, { buffer: RingBuffer, proc: import("node:child_process").ChildProcess | null, logFile: string }>} */
const projectState = new Map();

function getDevConfig(projectId) {
  const base = DEFAULT_DEV_CONFIG[projectId];
  if (!base) return null;
  const portEnv = process.env[`DEV_PORT_${projectId.toUpperCase()}`];
  return {
    port: portEnv ? Number(portEnv) : base.port,
  };
}

function logFilePath(projectId) {
  return path.join(getDevLogsDir(), `${projectId}.log`);
}

function ensureProjectState(projectId) {
  let state = projectState.get(projectId);
  if (!state) {
    state = {
      buffer: new RingBuffer(MAX_BUFFER_LINES, MAX_BUFFER_BYTES),
      proc: null,
    };
    projectState.set(projectId, state);
  }
  return state;
}

export function ensureDevLogsDir() {
  fs.mkdirSync(getDevLogsDir(), { recursive: true });
}

/** @param {number} port */
function probePort(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      resolve(false);
    });
  });
}

/** @param {import("node:child_process").ChildProcess} proc @param {RingBuffer} buffer */
function pipeProcessOutput(proc, buffer) {
  const ingest = (chunk) => {
    const text = chunk.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      if (line) buffer.push(line);
    }
  };

  proc.stdout?.on("data", ingest);
  proc.stderr?.on("data", ingest);
}

/**
 * @param {string} filePath
 * @param {{ lines?: number, maxBytes?: number }} [opts]
 */
function readFileTail(filePath, { lines = 150, maxBytes = 16_000 } = {}) {
  if (!fs.existsSync(filePath)) {
    return { lines: [], truncated: false };
  }

  const stat = fs.statSync(filePath);
  if (Date.now() - stat.mtimeMs > FILE_STALE_MS) {
    return { lines: [], truncated: false };
  }

  const content = fs.readFileSync(filePath, "utf8");
  const allLines = content.split(/\r?\n/).filter(Boolean);
  let selected = allLines.slice(-lines);
  let truncated = selected.length < allLines.length;

  let combined = selected.join("\n");
  if (Buffer.byteLength(combined, "utf8") > maxBytes) {
    truncated = true;
    while (
      selected.length > 1 &&
      Buffer.byteLength(selected.join("\n"), "utf8") > maxBytes
    ) {
      selected.shift();
    }
    combined = selected.join("\n");
  }

  return { lines: selected, truncated };
}

/**
 * @param {string} projectId
 */
export async function getDevStatus(projectId) {
  const config = getDevConfig(projectId);
  if (!config) {
    return {
      projectId,
      capturing: false,
      devServerReachable: false,
      port: null,
      lineCount: 0,
      logFile: logFilePath(projectId),
      managedPid: null,
    };
  }

  const state = ensureProjectState(projectId);
  const devServerReachable = await probePort(config.port);
  const logFile = logFilePath(projectId);
  const fileExists = fs.existsSync(logFile);
  const fileRecent =
    fileExists &&
    Date.now() - fs.statSync(logFile).mtimeMs <= FILE_STALE_MS;

  const capturing =
    state.proc !== null && !state.proc.killed
      ? true
      : fileRecent || state.buffer.lineCount > 0;

  return {
    projectId,
    capturing,
    devServerReachable,
    port: config.port,
    lineCount: state.buffer.lineCount,
    logFile,
    managedPid: state.proc?.pid ?? null,
    fileRecent: fileRecent ?? false,
  };
}

/**
 * @param {string} projectId
 * @param {{ lines?: number, maxBytes?: number }} [opts]
 */
export async function getRecentLogs(
  projectId,
  { lines = 150, maxBytes = 16_000 } = {},
) {
  const config = getDevConfig(projectId);
  if (!config) {
    return { lines: [], truncated: false, source: "none" };
  }

  const state = ensureProjectState(projectId);
  const bufferLines = state.buffer.tail(lines);

  if (bufferLines.length > 0) {
    let selected = bufferLines;
    let truncated = selected.length < state.buffer.lineCount;
    let combined = selected.join("\n");
    if (Buffer.byteLength(combined, "utf8") > maxBytes) {
      truncated = true;
      while (
        selected.length > 1 &&
        Buffer.byteLength(selected.join("\n"), "utf8") > maxBytes
      ) {
        selected.shift();
      }
    }
    return { lines: selected, truncated, source: "buffer" };
  }

  const fileResult = readFileTail(logFilePath(projectId), { lines, maxBytes });
  if (fileResult.lines.length > 0) {
    return { ...fileResult, source: "file" };
  }

  return { lines: [], truncated: false, source: "none" };
}

/**
 * @param {string} projectId
 * @param {string} prompt
 * @param {{ lines?: number, maxBytes?: number }} [opts]
 */
export async function buildPromptWithDevLogs(
  projectId,
  prompt,
  opts = {},
) {
  const config = getDevConfig(projectId);
  const logs = await getRecentLogs(projectId, opts);

  if (logs.lines.length === 0 || !config) {
    return { prompt, logsAttached: false, logLineCount: 0, source: logs.source };
  }

  const header = `--- Dev server logs (${projectId}, localhost:${config.port}, last ${logs.lines.length} lines) ---`;
  const footer = "--- End dev server logs ---";
  const body = logs.lines.join("\n");
  const omitted =
    logs.truncated ? "\n... [earlier lines omitted]" : "";

  const augmented = `${header}\n${body}${omitted}\n${footer}\n\n${prompt}`;
  return {
    prompt: augmented,
    logsAttached: true,
    logLineCount: logs.lines.length,
    source: logs.source,
  };
}

/**
 * @param {string} projectId
 */
export async function startDevServer(projectId) {
  const config = getDevConfig(projectId);
  if (!config) {
    throw new DevLogsError(`no dev config for project: ${projectId}`, 400);
  }

  const state = ensureProjectState(projectId);
  if (state.proc && !state.proc.killed) {
    return { ok: true, pid: state.proc.pid, alreadyRunning: true };
  }

  const cwd = resolveProject(projectId);
  const proc = spawn("pnpm", ["dev"], {
    cwd,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  state.proc = proc;
  pipeProcessOutput(proc, state.buffer);

  proc.on("exit", () => {
    if (state.proc === proc) {
      state.proc = null;
    }
  });

  return { ok: true, pid: proc.pid, alreadyRunning: false };
}

/**
 * @param {string} projectId
 */
export async function stopDevServer(projectId) {
  const state = projectState.get(projectId);
  if (!state?.proc || state.proc.killed) {
    return { ok: true, stopped: false };
  }

  state.proc.kill("SIGTERM");
  state.proc = null;
  return { ok: true, stopped: true };
}

export function stopAllManagedDevServers() {
  for (const state of projectState.values()) {
    if (state.proc && !state.proc.killed) {
      state.proc.kill("SIGTERM");
      state.proc = null;
    }
  }
}

export { RingBuffer };

export class DevLogsError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "DevLogsError";
    this.status = status;
  }
}
