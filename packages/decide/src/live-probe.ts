// The live tests' key check: one GET of the model list per process tells a rejected (expired) key and an unreachable server from a working one, so the live tests skip with a reason instead of failing.
import { JEV_BASE_URL } from "./jev.js";

const PROBE_TIMEOUT_MS = 8000;

/** The skip reason for a key the server refuses. */
export const KEY_REJECTED_REASON = "TypeSafe key rejected (expired?)";

/** The skip reason for a server that cannot be reached. */
export const NETWORK_DOWN_REASON = "TypeSafe unreachable (network outage?)";

/** The skip reason when no key is set. */
export const KEY_MISSING_REASON = "TYPESAFE_API_KEY not set";

const probed = new Map<string, Promise<string | false>>();

async function askServer(apiKey: string, baseUrl: string): Promise<string | false> {
  try {
    const reply = await fetch(`${baseUrl}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (reply.status === 401 || reply.status === 403) return KEY_REJECTED_REASON;
    return false;
  } catch {
    return NETWORK_DOWN_REASON;
  }
}

/** Why a live test should skip: no key, a rejected key or no network; false when the key works. Asks the server once per key and process. */
export function liveSkipReason(apiKey: string, baseUrl: string = JEV_BASE_URL): Promise<string | false> {
  if (apiKey === "") return Promise.resolve(KEY_MISSING_REASON);
  const cached = probed.get(apiKey);
  if (cached !== undefined) return cached;
  const fresh = askServer(apiKey, baseUrl);
  probed.set(apiKey, fresh);
  return fresh;
}
