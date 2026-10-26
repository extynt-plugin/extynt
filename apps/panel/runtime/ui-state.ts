/**
 * What the panel knows about the sidecar and After Effects right now: the bootstrap answer, then the events that update it.
 * One store, changed only by `dispatch`, read by every view; views subscribe to the parts they draw.
 */
import type { Quarantine } from "./native-quarantine.js";
import type { NativeInfo } from "./native.js";
import { DEFAULT_PREFS } from "./ui-contract.js";
import type { Language } from "@extynt/ui-text";
import type { Bootstrap, HostStatus, UiEvent, UiFocus, UiPrefs } from "./ui-contract.js";
import type { UiJob, UiMcpCall } from "./ui-jobs.js";
import { sameJson } from "./same-json.js";

/** The parts of the state a view can subscribe to. */
export type UiTopic = "dropped" | "host" | "focus" | "prefs" | "model" | "undo" | "reach" | "change" | "plans" | "closing" | "thumbs" | "preview" | "decision" | "activity" | "mcp" | "language";

interface UndoState {
  readonly available: boolean;
  readonly reason: string | null;
  readonly code: string | null;
}

interface DroppedCounts {
  readonly streamFrames: number;
  readonly chatLogEvents: number;
}

interface UiState {
  readonly native: NativeInfo | null;
  readonly reachable: boolean;
  readonly unreachableSince: number | null;
  readonly host: HostStatus | null;
  readonly hostInstanceId: string;
  readonly awaitingSnapshot: boolean;
  readonly quarantine: Quarantine | null;
  readonly prefs: UiPrefs;
  readonly interfaceLanguage: Language;
  readonly focus: UiFocus | null;
  readonly project: string | null;
  readonly sidecarVersion: string;
  readonly mcpVersion: string;
  readonly uiBuild: string | null;
  readonly modelConfigured: boolean | null;
  readonly modelAcceptsImages: boolean;
  readonly jobs: ReadonlyArray<UiJob>;
  readonly mcpCalls: ReadonlyArray<UiMcpCall>;
  readonly dropped: DroppedCounts;
}

type StoreEvent =
  | { readonly type: "native"; readonly native: NativeInfo | null }
  | { readonly type: "dropped"; readonly what: keyof DroppedCounts }
  | { readonly type: "reachable"; readonly reachable: boolean; readonly now: number }
  | { readonly type: "prefs"; readonly prefs: UiPrefs }
  | { readonly type: "language"; readonly language: Language }
  | { readonly type: "model-configured"; readonly configured: boolean }
  | { readonly type: "model-images"; readonly accepts: boolean }
  | { readonly type: "bootstrap"; readonly bootstrap: Bootstrap }
  | { readonly type: "undo"; readonly planId: string; readonly undo: UndoState }
  | { readonly type: "stream"; readonly event: UiEvent };

type Listener = (topic: UiTopic, detail?: string) => void;

const MAX_MCP_CALLS = 100;

let state: UiState = {
  native: null,
  reachable: true,
  unreachableSince: null,
  host: null,
  hostInstanceId: "",
  awaitingSnapshot: false,
  quarantine: null,
  prefs: DEFAULT_PREFS,
  interfaceLanguage: "en",
  focus: null,
  project: null,
  sidecarVersion: "",
  mcpVersion: "",
  uiBuild: null,
  modelConfigured: null,
  modelAcceptsImages: true,
  jobs: [],
  mcpCalls: [],
  dropped: { streamFrames: 0, chatLogEvents: 0 },
};
const undoStates = new Map<string, UndoState>();
const listeners: Listener[] = [];

/** The state as it is now. */
export function uiState(): Readonly<UiState> {
  return state;
}

/** What the sidecar last said about undoing a plan, or null before it said anything. */
export function undoStateOf(planId: string): UndoState | null {
  return undoStates.get(planId) ?? null;
}

/** Calls the listener after every change, with the part that changed. */
export function subscribeUi(listener: Listener): void {
  listeners.push(listener);
}

const closings = new Map<string, string>();

/** The closing reply a stream event carried for a request, handed over once. */
export function takeClosing(requestId: string): string {
  const text = closings.get(requestId) ?? "";
  closings.delete(requestId);
  return text;
}

function publish(topic: UiTopic, detail?: string): void {
  for (const listener of listeners.slice()) listener(topic, detail);
}

function change(next: Partial<UiState>): void {
  state = { ...state, ...next };
}

function changeUndo(planId: string, undo: UndoState): void {
  const before = undoStates.get(planId);
  undoStates.set(planId, undo);
  if (!before || before.available !== undo.available || before.code !== undo.code) publish("undo", planId);
}

function changeReachable(reachable: boolean, now: number): void {
  if (state.reachable === reachable) return;
  change({ reachable, unreachableSince: reachable ? null : now });
  publish("reach");
}

function changeDropped(what: keyof DroppedCounts): void {
  change({ dropped: { ...state.dropped, [what]: state.dropped[what] + 1 } });
  publish("dropped");
}

function changeJobs(jobs: ReadonlyArray<UiJob>): void {
  if (sameJson(state.jobs, jobs)) return;
  change({ jobs });
  publish("activity");
}

function foldMcpCalls(calls: ReadonlyArray<UiMcpCall>): void {
  const held = [...state.mcpCalls];
  for (const call of calls) {
    const at = held.findIndex((entry) => entry.id === call.id);
    if (at >= 0) held.splice(at, 1, call);
    else held.push(call);
  }
  change({ mcpCalls: held.slice(-MAX_MCP_CALLS) });
  publish("mcp");
}

function changeLanguage(language: Language): void {
  if (state.interfaceLanguage === language) return;
  change({ interfaceLanguage: language });
  publish("language");
}

function changeBootstrap(boot: Bootstrap): void {
  change({
    host: boot.host,
    hostInstanceId: boot.hostInstanceId ?? "",
    awaitingSnapshot: boot.awaitingSnapshot,
    quarantine: boot.nativeAccessQuarantine,
    prefs: boot.prefs,
    focus: boot.focus,
    project: boot.project,
    sidecarVersion: boot.sidecarVersion,
    mcpVersion: boot.mcpVersion,
    uiBuild: boot.uiBuild,
  });
  publish("host");
  publish("focus");
  publish("prefs");
  changeLanguage(boot.interfaceLanguage);
  changeJobs(boot.jobs);
}

function changeHost(event: Extract<UiEvent, { type: "host" }>): void {
  change({ host: event.host, hostInstanceId: event.hostInstanceId ?? state.hostInstanceId, awaitingSnapshot: event.awaitingSnapshot, quarantine: event.nativeAccessQuarantine });
  publish("host");
  changeLanguage(event.interfaceLanguage);
}

function changeNotice(event: UiEvent): void {
  switch (event.type) {
    case "plans":
      publish("plans", event.planId ?? undefined);
      return;
    case "closing":
      closings.set(event.requestId, event.text);
      publish("closing", event.requestId);
      return;
    default:
      changeSideNotice(event);
  }
}

function changeSideNotice(event: UiEvent): void {
  switch (event.type) {
    case "thumbs":
      publish("thumbs", event.planId);
      return;
    case "preview":
      publish("preview", event.setId);
      return;
    case "decision":
      publish("decision", event.reason);
      return;
    case "change":
      publish("change", event.planId ?? undefined);
      return;
    default:
      return;
  }
}

function changeFromStream(event: UiEvent): void {
  switch (event.type) {
    case "host":
      changeHost(event);
      return;
    case "focus":
      change({ focus: event.focus });
      publish("focus");
      return;
    case "undo":
      changeUndo(event.planId, { available: event.undo.available, reason: event.undo.reason, code: event.undo.code });
      return;
    case "activity":
      changeJobs(event.jobs);
      return;
    case "mcp":
      foldMcpCalls(event.calls);
      return;
    default:
      changeNotice(event);
  }
}

function changeConfigured(configured: boolean): void {
  if (state.modelConfigured === configured) return;
  change({ modelConfigured: configured });
  publish("model");
}

function changeModel(event: Extract<StoreEvent, { type: "native" | "model-configured" | "model-images" }>): void {
  switch (event.type) {
    case "native":
      change({ native: event.native });
      return;
    case "model-configured":
      changeConfigured(event.configured);
      return;
    case "model-images":
      change({ modelAcceptsImages: event.accepts });
      return;
  }
}

function changePrefs(prefs: UiState["prefs"]): void {
  change({ prefs });
  publish("prefs");
}

/** Applies one event to the state and tells the subscribers of the parts it touched. */
export function dispatch(event: StoreEvent): void {
  switch (event.type) {
    case "reachable":
      changeReachable(event.reachable, event.now);
      return;
    case "dropped":
      changeDropped(event.what);
      return;
    case "prefs":
      changePrefs(event.prefs);
      return;
    case "language":
      changeLanguage(event.language);
      return;
    case "bootstrap":
      changeBootstrap(event.bootstrap);
      return;
    case "undo":
      changeUndo(event.planId, event.undo);
      return;
    case "stream":
      changeFromStream(event.event);
      return;
    default:
      changeModel(event);
  }
}
