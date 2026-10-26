/** Pieces every provider adapter needs the same way: a fetch implementation, the timeout around one request, whether a key is ready, and the positive-limit options. */
import type { SecretSource } from "./provider-secret.js";
import { linkAbortSignal } from "./provider-stall.js";

export const REFUSAL_LESSONS_PER_STEP = 3;
export const DISCOVERY_TIMEOUT_MS = 8_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export function serverFetch(candidate: typeof globalThis.fetch | undefined): typeof globalThis.fetch {
  const request = candidate ?? globalThis.fetch;
  if (!request) throw new Error("A server fetch implementation is required.");
  return request;
}

export function keyReady(source: SecretSource): boolean {
  return source.resolve() !== undefined || source.keyless === true;
}

/** Runs one request under its own abort signal, which fires after `ms` or when the caller's `signal` aborts. */
export async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>, caller?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  const releaseCaller = linkAbortSignal(caller, controller);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeout);
    releaseCaller();
  }
}

export function positiveInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function positiveLimit(value: number | undefined, fallback: number): number {
  return positiveInteger(value) ?? fallback;
}
