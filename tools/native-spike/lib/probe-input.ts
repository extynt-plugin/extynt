/** Reads a probe snapshot from a file or the sidecar and classifies its shape. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeJson, fallback, isJsonArray, isJsonObject, jsonValue, number, object, optional, string } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { extyntStateDirectory } from "./discovery.ts";
import { SpikeError } from "./errors.ts";
import { objectAt, textAt } from "./json-access.ts";

/** The input name reported for a snapshot fetched from the sidecar. */
export const SIDECAR_INPUT = "sidecar /v1/snapshots/latest";

const DEFAULT_SIDECAR_PORT = 3210;
const NO_SESSION = { port: null, token: null };

const SESSION = object({
  port: optional(fallback(number({ int: true }), undefined)),
  token: optional(fallback(string(), undefined)),
});

/** A probe result and which kind of input it came from. */
export interface ClassifiedProbe {
  readonly result: JsonObject;
  readonly input: string;
}

/** Where the sidecar is: flags, with the session file as the fallback source of port and token. */
export interface SidecarLocation {
  readonly sidecar?: string | undefined;
  readonly sidecarToken?: string | undefined;
  readonly sessionFile?: string | undefined;
}

/** The sidecar location and the environment to read AE_BRIDGE_PORT and AE_BRIDGE_TOKEN from. */
export interface SidecarOptions extends SidecarLocation {
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

/** The sidecar URL and bearer token (null when none was found). */
export interface ResolvedSidecar {
  readonly url: string;
  readonly token: string | null;
}

/** The part of a fetch response the sidecar client reads. */
export interface SidecarResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
}

/** The part of fetch the sidecar client calls. */
export type SidecarFetch = (url: string, init: { readonly headers: { readonly Authorization: string } }) => Promise<SidecarResponse>;

interface ProbeFailure {
  readonly code: string;
  readonly message: string;
}

function probeFailure(root: JsonObject): ProbeFailure | null {
  const failed = [objectAt(root, "snapshot"), root].find((candidate) => candidate.ok === false);
  if (!failed) return null;
  const error = failed.error;
  const detail = isJsonObject(error) ? error : {};
  return {
    code: textAt(detail, "code") ?? "UNKNOWN",
    message: textAt(detail, "message") ?? (typeof error === "string" ? error : "no message"),
  };
}

function resultIn(value: JsonValue | undefined): JsonObject | undefined {
  if (!isJsonObject(value)) return undefined;
  return isJsonArray(value.compositions) || isJsonArray(value.items) ? value : undefined;
}

/**
 * Accepts the raw probe envelope, a saved sidecar /v1/snapshots/latest response, or the bare result object.
 * Returns {result, input} where input names which of the three it was. A probe that answered ok:false is an error.
 */
export function classifyProbe(json: JsonValue): ClassifiedProbe {
  const root = isJsonObject(json) ? json : {};
  const failure = probeFailure(root);
  if (failure) {
    throw new SpikeError("PROBE_ERROR", `The probe reported an error instead of a snapshot: ${failure.code}: ${failure.message}. Re-run the probe (see probe-dump.jsx for the paged runner) and pass the new file.`);
  }
  const sidecar = resultIn(objectAt(objectAt(root, "snapshot"), "result"));
  if (sidecar) return { result: sidecar, input: "sidecar snapshot file" };
  const envelope = resultIn(root.result);
  if (envelope) return { result: envelope, input: "raw probe envelope file" };
  const bare = resultIn(root);
  if (bare) return { result: bare, input: "bare result file" };
  throw new SpikeError("PROBE_FORMAT", "Probe file is not recognised: expected an envelope {result:{...}}, a sidecar response {snapshot:{result:{...}}} or a bare result with items/compositions.");
}

/** The probe result inside any of the accepted shapes. */
export function extractProbeResult(json: JsonValue): JsonObject {
  return classifyProbe(json).result;
}

function parseOnce(text: string): JsonValue | undefined {
  const decoded = decodeJson(text.replace(/^﻿/, ""), jsonValue);
  return decoded.ok ? decoded.value : undefined;
}

/** Parses probe file text: tolerates a UTF-8 BOM and a file holding the envelope as one JSON-encoded string; undefined when it is not JSON. */
export function parseProbeText(text: string): JsonValue | undefined {
  const value = parseOnce(text);
  return typeof value === "string" ? parseOnce(value) : value;
}

function readProbeText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new SpikeError("PROBE_UNREADABLE", `Cannot read probe file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Reads a probe file; resolves {result, input} (see classifyProbe). */
export function loadProbeFile(path: string): ClassifiedProbe {
  const json = parseProbeText(readProbeText(path));
  if (json === undefined) {
    throw new SpikeError("PROBE_FORMAT", `Probe file ${path} is not valid JSON (a UTF-8 BOM and one level of JSON string encoding are tolerated).`);
  }
  return classifyProbe(json);
}

function readSessionFile(path: string): { readonly port: number | null; readonly token: string | null } {
  try {
    const decoded = decodeJson(readFileSync(path, "utf8"), SESSION);
    return decoded.ok ? { port: decoded.value.port ?? null, token: decoded.value.token ?? null } : NO_SESSION;
  } catch {
    return NO_SESSION;
  }
}

/** Resolves the sidecar URL and bearer token: flags, then environment, then the sidecar's per-user session file. */
export function resolveSidecar(options: SidecarLocation, env: Readonly<Record<string, string | undefined>> = process.env): ResolvedSidecar {
  const session = readSessionFile(options.sessionFile ?? join(extyntStateDirectory(), "session.json"));
  const port = env.AE_BRIDGE_PORT || session.port || DEFAULT_SIDECAR_PORT;
  return {
    url: (options.sidecar ?? `http://127.0.0.1:${port}`).replace(/\/+$/, ""),
    token: options.sidecarToken ?? env.AE_BRIDGE_TOKEN ?? session.token,
  };
}

function failureFor(status: number, url: string): SpikeError {
  if (status === 401) return new SpikeError("SIDECAR_UNAUTHORIZED", `The sidecar at ${url} rejected the bearer token. Pass --sidecar-token, set AE_BRIDGE_TOKEN, or restart the sidecar so it rewrites session.json.`);
  if (status === 404) return new SpikeError("NO_SNAPSHOT", `The sidecar at ${url} has no snapshot yet. Open the extynt panel in After Effects and wait for the whole-project read to finish.`);
  return new SpikeError("SIDECAR_ERROR", `The sidecar at ${url} answered HTTP ${status}.`);
}

function unreachableReason(error: Error): string {
  return error.cause instanceof Error ? error.cause.message : error.message;
}

async function requestLatest(url: string, token: string, fetchImpl: SidecarFetch): Promise<SidecarResponse> {
  try {
    return await fetchImpl(`${url}/v1/snapshots/latest`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    const reason = error instanceof Error ? unreachableReason(error) : String(error);
    throw new SpikeError("SIDECAR_UNREACHABLE", `Cannot reach the sidecar at ${url}: ${reason}. Is it running (AE_BRIDGE_PORT, session.json)?`);
  }
}

/** Fetches the sidecar's latest snapshot and classifies it. */
export async function fetchSidecarSnapshot(options: SidecarOptions, fetchImpl: SidecarFetch = globalThis.fetch): Promise<ClassifiedProbe> {
  const { url, token } = resolveSidecar(options, options.env);
  if (!token) throw new SpikeError("SIDECAR_NO_TOKEN", "No sidecar bearer token: pass --sidecar-token, set AE_BRIDGE_TOKEN, or run where the sidecar's session.json is readable (see --session-file).");
  const response = await requestLatest(url, token, fetchImpl);
  if (!response.ok) throw failureFor(response.status, url);
  const body = decodeJson(await response.text(), jsonValue);
  if (!body.ok) throw new SpikeError("SIDECAR_ERROR", `The sidecar at ${url} answered something that is not JSON.`);
  return { result: classifyProbe(body.value).result, input: SIDECAR_INPUT };
}
