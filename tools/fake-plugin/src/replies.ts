// What a handler may answer with, and the constructors for each shape. A reply describes bytes on the wire, so a test can
// script a good answer, a refusal, a late or missing answer, a hang-up, split writes or garbage with the same vocabulary.
import type { HostCallResult, WireError, WireTiming } from "@extynt/host-native";
import type { WireValue } from "./wire.js";

/** The `host_call` result members a reply may set beyond the entry's own text. */
export type HostMeta = Partial<Omit<HostCallResult, "source" | "entry" | "result">>;

/** What a handler answers with: a success, an error, a late, missing or garbled answer, or a hang-up. */
export type Reply =
  | { kind: "ok"; result: WireValue; timing?: Partial<WireTiming> | undefined; hostMeta?: HostMeta | undefined }
  | { kind: "error"; error: WireError }
  | { kind: "late"; delayMs: number; then: Reply }
  | { kind: "stall" }
  | { kind: "close" }
  | { kind: "raw"; text: string }
  | { kind: "chunks"; chunks: string[]; gapMs: number };

/** A success. For `host_call` the result is the string the entry returned; the value is serialised when the reply is written. */
export function ok(result: WireValue, extra: { timing?: Partial<WireTiming> | undefined; hostMeta?: HostMeta | undefined } = {}): Reply {
  return { kind: "ok", result, ...extra };
}

/** An error answer with the protocol's code, and the After Effects error number when there is one. */
export function refuse(code: string, message: string, aeErr?: number): Reply {
  return { kind: "error", error: aeErr === undefined ? { code, message } : { code, message, aeErr } };
}

/** Answers `then` after `delayMs`; the connection is busy meanwhile, as the real plugin's is. */
export function late(delayMs: number, then: Reply): Reply {
  return { kind: "late", delayMs, then };
}

/** Never answers: the connection stays blocked until it closes. */
export function stall(): Reply {
  return { kind: "stall" };
}

/** Hangs up on the requester without answering. */
export function hangUp(): Reply {
  return { kind: "close" };
}

/** Writes literal bytes (no newline is added), for garbage and for several lines in one write. */
export function raw(text: string): Reply {
  return { kind: "raw", text };
}

/** Writes each chunk separately, `gapMs` apart: a line split mid-token. */
export function chunked(chunks: string[], gapMs = 5): Reply {
  return { kind: "chunks", chunks, gapMs };
}

/** Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** A reply that produces bytes (or none) as it stands, with no delay left to wait out. */
export type Settled = Exclude<Reply, { kind: "late" }>;

/** Follows `late` replies, waiting out each delay, and returns the reply that finally produces bytes. */
export async function settle(reply: Reply): Promise<Settled> {
  let current = reply;
  while (current.kind === "late") {
    await sleep(current.delayMs);
    current = current.then;
  }
  return current;
}
