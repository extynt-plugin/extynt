/**
 * The live link to the sidecar: /v1/ui/events read as a progressive XHR (an EventSource cannot send the bearer). Events
 * update the shared state. When the stream drops, a 1 s poll of /v1/ui/bootstrap keeps the panel current until it is back.
 */
import { decodeJson } from "@extynt/decode";
import { loadBootstrap } from "./ui-api.js";
import { later, noteAnswered, noteNoAnswer, reloadForFreshToken } from "./panel-transport.js";
import { eventDecoderFor } from "./ui-contract.js";
import { dispatch, uiState } from "./ui-state.js";

const POLL_MS = 1000;
const WATCHDOG_MS = 45000;
const RETRY_MS = [1000, 2000, 5000];

interface Frame {
  readonly name: string;
  readonly data: string;
}

function frameOf(block: string): Frame {
  let name = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).replace(/^ /, "");
  }
  return { name, data };
}

function readFrames(buffer: string): { readonly frames: ReadonlyArray<Frame>; readonly rest: string } {
  const frames: Frame[] = [];
  let rest = buffer.replace(/\r\n/g, "\n");
  for (let end = rest.indexOf("\n\n"); end >= 0; end = rest.indexOf("\n\n")) {
    const frame = frameOf(rest.slice(0, end));
    rest = rest.slice(end + 2);
    if (frame.data) frames.push(frame);
  }
  return { frames, rest };
}

let stream: XMLHttpRequest | null = null;
let consumed = 0;
let pending = "";
let failures = 0;
let live = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let watchdog: ReturnType<typeof setTimeout> | null = null;
let started = false;

function deliver(frames: ReadonlyArray<Frame>): void {
  for (const frame of frames) {
    const decoder = eventDecoderFor(frame.name);
    const decoded = decoder === null ? null : decodeJson(frame.data, decoder);
    if (decoded?.ok) dispatch({ type: "stream", event: decoded.value });
    else if (decoder !== null) dispatch({ type: "dropped", what: "streamFrames" });
  }
}

function cancelWatchdog(): void {
  if (watchdog !== null && typeof clearTimeout === "function") clearTimeout(watchdog);
}

function armWatchdog(): void {
  cancelWatchdog();
  watchdog = later(() => stream?.abort(), WATCHDOG_MS);
}

function poll(): void {
  pollTimer = null;
  if (live) return;
  loadBootstrap((reply) => {
    if (reply.ok) {
      dispatch({ type: "bootstrap", bootstrap: reply.value });
      dispatch({ type: "stream", event: { type: "change", seq: 0, reason: "poll", planId: null } });
      dispatch({ type: "reachable", reachable: true, now: Date.now() });
    }
    if (!live) pollTimer = later(poll, POLL_MS);
  });
}

function dropped(): void {
  stream = null;
  live = false;
  cancelWatchdog();
  failures += 1;
  if (pollTimer === null) pollTimer = later(poll, POLL_MS);
  later(connect, RETRY_MS.at(Math.min(failures - 1, RETRY_MS.length - 1)) ?? POLL_MS);
}

function onProgress(xhr: XMLHttpRequest): void {
  if (xhr.status === 200 && !live) {
    live = true;
    failures = 0;
    noteAnswered();
    dispatch({ type: "reachable", reachable: true, now: Date.now() });
  }
  armWatchdog();
  const text = xhr.responseText;
  pending += text.slice(consumed);
  consumed = text.length;
  const read = readFrames(pending);
  pending = read.rest;
  deliver(read.frames);
}

function onLoaded(xhr: XMLHttpRequest): void {
  noteAnswered();
  if (xhr.status === 401) {
    reloadForFreshToken();
    return;
  }
  onProgress(xhr);
  dropped();
}

function connect(): void {
  const native = uiState().native;
  if (!native || stream) return;
  const xhr = new XMLHttpRequest();
  stream = xhr;
  consumed = 0;
  pending = "";
  xhr.open("GET", native.sidecarOrigin + "/v1/ui/events", true);
  xhr.setRequestHeader("Authorization", "Bearer " + native.token);
  xhr.setRequestHeader("Accept", "text/event-stream");
  xhr.onprogress = () => onProgress(xhr);
  xhr.onload = () => onLoaded(xhr);
  xhr.onerror = () => {
    dispatch({ type: "reachable", reachable: false, now: Date.now() });
    noteNoAnswer();
    dropped();
  };
  xhr.onabort = () => dropped();
  xhr.send(null);
}

/** Opens the stream once; it reconnects by itself. */
export function startUiSync(): void {
  if (started) return;
  started = true;
  connect();
}
