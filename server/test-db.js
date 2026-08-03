import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeBridgeDb, openBridgeDb, _resetDbForTests } from "./db.js";

let tempPath = null;

/**
 * Open an isolated bridge SQLite DB for tests (no JSON migration).
 * Call before constructing SessionManager in tests.
 */
export function useTempBridgeDb() {
  if (tempPath) {
    try {
      closeBridgeDb();
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(`${tempPath}-wal`);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(`${tempPath}-shm`);
    } catch {
      /* ignore */
    }
  }
  tempPath = path.join(
    os.tmpdir(),
    `cursor-bridge-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  );
  process.env.BRIDGE_DB_PATH = tempPath;
  openBridgeDb({ path: tempPath, migrateJson: false });
  _resetDbForTests();
  return tempPath;
}

export function resetTempBridgeDb() {
  if (!tempPath) useTempBridgeDb();
  else _resetDbForTests();
}
