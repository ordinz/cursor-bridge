import { Cursor } from "@cursor/sdk";

let cached = /** @type {{ checkedAt: number; result: CursorConnectivity } | null} */ (
  null
);

const CACHE_MS = 30_000;

/**
 * @typedef {{ ready: boolean; reason?: string }} CursorConnectivity
 */

/**
 * @returns {Promise<CursorConnectivity>}
 */
export async function checkCursorConnectivity({ force = false } = {}) {
  if (!process.env.CURSOR_API_KEY) {
    return { ready: false, reason: "api_key_missing" };
  }

  const now = Date.now();
  if (!force && cached && now - cached.checkedAt < CACHE_MS) {
    return cached.result;
  }

  try {
    await Cursor.models.list({ apiKey: process.env.CURSOR_API_KEY });
    const result = { ready: true };
    cached = { checkedAt: now, result };
    return result;
  } catch (err) {
    const result = {
      ready: false,
      reason: err instanceof Error ? err.message : "cursor_unreachable",
    };
    cached = { checkedAt: now, result };
    return result;
  }
}
