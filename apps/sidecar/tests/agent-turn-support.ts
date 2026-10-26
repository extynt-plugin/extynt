// Helpers the running-turn tests share: the sidecar's chat and progress endpoints, a snapshot post, a captured stdout log and a cancellation probe that never leaks its timer.
import type { TestContext } from "node:test";
import { decodeJson, number, object, optional, string, type Infer } from "@extynt/decode";
import { fieldOf, readJson, recordOf, recordsOf, type JsonObject } from "./http-json.js";
import { authorization, mutableSnapshot, pause } from "./sidecar-fixture.js";

/** Where a started sidecar listens. */
export interface SidecarAddress {
  readonly host: string;
  readonly port: number;
}

const LOG_LINE = object({ event: string(), requestId: optional(string()), jobId: optional(string()), step: optional(number()), waitedMs: optional(number()) });

/** The structured fields of one log line the sidecar wrote. */
export type LogEvent = Infer<typeof LOG_LINE>;

const JSON_HEADERS = { ...authorization, "content-type": "application/json" };

/** The sidecar's origin, for building request URLs. */
export function baseUrl(address: SidecarAddress): string {
  return `http://${address.host}:${address.port}`;
}

/** Posts the mutable test snapshot under `requestId`, so a chat turn has a project to read. */
export async function postSnapshot(address: SidecarAddress, requestId: string): Promise<void> {
  await fetch(`${baseUrl(address)}/v1/snapshots`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(mutableSnapshot(requestId)) });
}

/** Resolves true when `signal` aborts and false after five seconds or when no signal was given; the give-up timer is cleared on abort so no live handle outlives the test. */
export function cancellationReached(signal: AbortSignal | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    if (!signal) { resolve(false); return; }
    if (signal.aborted) { resolve(true); return; }
    const giveUp = setTimeout(() => resolve(false), 5_000);
    signal.addEventListener("abort", () => { clearTimeout(giveUp); resolve(true); }, { once: true });
  });
}

/** The progress line of the turn `requestId`, or null when no such turn is running. */
export async function progressForTurn(address: SidecarAddress, requestId: string): Promise<JsonObject | null> {
  const response = await fetch(`${baseUrl(address)}/v1/chat/progress?requestId=${encodeURIComponent(requestId)}`, { headers: authorization });
  const body = await readJson(response);
  return fieldOf(body, "progress") ? recordOf(body, "progress") : null;
}

/** Polls until the turn `requestId` has a progress line; null when none appeared. */
export async function waitForProgress(address: SidecarAddress, requestId: string): Promise<JsonObject | null> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const progress = await progressForTurn(address, requestId);
    if (progress) return progress;
    await pause(10);
  }
  return null;
}

/** Polls until the turn `requestId` has no progress line left. */
export async function waitForTurnEnd(address: SidecarAddress, requestId: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (!await progressForTurn(address, requestId)) return;
    await pause(10);
  }
}

/** Posts a chat turn and reads its reply object. */
export async function postChat(address: SidecarAddress, requestId: string, message: string): Promise<JsonObject> {
  const response = await fetch(`${baseUrl(address)}/v1/chat`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ requestId, message }) });
  return recordOf(await readJson(response), "");
}

/** Starts a chat turn the caller may abandon by aborting `signal`; resolves null when the connection is cut. */
export function postAbandonableChat(address: SidecarAddress, body: JsonObject, signal: AbortSignal): Promise<Response | null> {
  return fetch(`${baseUrl(address)}/v1/chat`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body), signal }).catch(() => null);
}

/** The plans the sidecar holds ready for the panel to apply. */
export async function readyPlans(address: SidecarAddress): Promise<JsonObject[]> {
  return recordsOf(await readJson(await fetch(`${baseUrl(address)}/v1/chat/plans/ready`, { headers: authorization })), "plans");
}

/** Asks the sidecar to stop whatever turn is running. */
export function postStop(address: SidecarAddress): Promise<Response> {
  return fetch(`${baseUrl(address)}/v1/ui/stop`, { method: "POST", headers: JSON_HEADERS, body: "{}" });
}

/** Captures what the process writes to stdout until the test restores its mocks. */
export function captureStdout(t: TestContext): string[] {
  const lines: string[] = [];
  t.mock.method(process.stdout, "write", (chunk: string | Uint8Array) => { lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")); return true; });
  return lines;
}

/** The structured log lines among captured stdout chunks; anything else is skipped. */
export function logEvents(lines: readonly string[]): LogEvent[] {
  return lines.flatMap((line) => {
    const decoded = decodeJson(line, LOG_LINE);
    return decoded.ok ? [decoded.value] : [];
  });
}
