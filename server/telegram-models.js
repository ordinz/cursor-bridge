import { Cursor } from "@cursor/sdk";

/** @type {{ id: string, displayName: string }[]} */
let cachedModels = [
  { id: "default", displayName: "Auto" },
  { id: "composer-2", displayName: "Composer 2" },
  { id: "composer-2.5", displayName: "Composer 2.5" },
];

let lastFetchAt = 0;
const CACHE_MS = 5 * 60 * 1000;

/**
 * @returns {Promise<{ id: string, displayName: string }[]>}
 */
export async function listTelegramModels() {
  const now = Date.now();
  if (now - lastFetchAt < CACHE_MS && cachedModels.length) {
    return cachedModels;
  }
  try {
    const models = await Cursor.models.list({
      apiKey: process.env.CURSOR_API_KEY,
    });
    if (Array.isArray(models) && models.length) {
      cachedModels = models.map((m) => ({
        id: String(m.id),
        displayName: String(m.displayName || m.id),
      }));
      lastFetchAt = now;
    }
  } catch (err) {
    console.warn(
      "[telegram] models.list failed, using cache:",
      err instanceof Error ? err.message : err,
    );
  }
  return cachedModels;
}

export function getCachedTelegramModels() {
  return cachedModels;
}

export function modelLabel(modelId) {
  const hit = cachedModels.find((m) => m.id === modelId);
  return hit?.displayName || modelId || "Auto";
}

/** Test helper */
export function _setTelegramModelsForTests(models) {
  cachedModels = models.map((m) => ({
    id: String(m.id),
    displayName: String(m.displayName || m.id),
  }));
  lastFetchAt = Date.now();
}
