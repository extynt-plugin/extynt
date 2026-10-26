// The native lane's event intake. The plugin pushes `change`, `still`, `overflow` and `host-closing`; this turns them into the
// sidecar's live view of After Effects and the reads it needs. Nothing polls: a change arrives the moment AE moves, and the only
// timer is the short window that folds a burst of edits into one read.
import type { ChangeReason, PluginEvent, WatchState } from "@extynt/host-native";
import { jsonFieldsOf } from "@extynt/mcp-server";
import { focusContextOf, type FocusContext } from "../focus-overlay.js";
import type { InProcessReceivers } from "../receiver-types.js";
import { queueSnapshotRefresh } from "../read-queue.js";
import { tickReadScheduler, type SchedulerState } from "../read-scheduler.js";
import type { SidecarState } from "../server-state.js";
import { focusBodyOf } from "./focus-body.js";
import { discardUiEvents, type UiEventSink } from "./ui-events.js";

/** Edits that follow one another within this window become one read. */
export const READ_COALESCE_MS = 150;
/** How long an event stamp stays current without a `still` or `change` confirming it: two missed 1 s stills. */
export const EVENT_STAMP_TTL_MS = 2500;

const READ_FREE_REASONS: ReadonlySet<ChangeReason> = new Set(["selection", "time", "active"]);

type CancelTimer = () => void;
type ChangeListener = (watch: WatchState, reasons: ChangeReason[]) => void;
type EventOf<Name extends PluginEvent["event"]> = Extract<PluginEvent, { event: Name }>;
type EventState = SchedulerState & Pick<SidecarState, "catalogue" | "hostWake" | "panel">;
type ChangeSummary = { epoch: number; revision: number | null; items: number | null };

/** Starts a timer and returns what cancels it; the one clock the intake and the census retries share, so a test fires them by hand. */
export interface EventTimers { set(run: () => void, delayMs: number): CancelTimer }

export const realTimers: EventTimers = {
  set: (run, delayMs) => {
    const handle = setTimeout(run, delayMs);
    handle.unref();
    return () => { clearTimeout(handle); };
  },
};

/**
 * The intake of plugin events. `onEvent` is passed as `ConnectOptions.onEvent`; `onChange` registers a listener called with the plugin's state on every
 * `change` event; `scan` asks the scheduler what to read now, folded with any ask already waiting (a read that lands calls it so an edit made meanwhile
 * is not forgotten); `reset` is for a link that went down or came back and forgets the stamp, the last published view and any waiting ask.
 */
export interface HostEvents {
  onEvent(event: PluginEvent): void;
  onChange(listener: ChangeListener): void;
  scan(): void;
  reset(): void;
}

function sameLayers(a: FocusContext["selectedLayers"], b: FocusContext["selectedLayers"]): boolean {
  return a.length === b.length && a.every((layer, index) => layer.id === b[index]?.id && layer.name === b[index]?.name);
}

function sameContext(a: FocusContext | null, b: FocusContext): boolean {
  return a !== null && a.projectName === b.projectName && a.compositionId === b.compositionId && a.selected === b.selected && a.time === b.time && a.projectSaved === b.projectSaved && sameLayers(a.selectedLayers, b.selectedLayers);
}

function sameChange(a: ChangeSummary | null, b: ChangeSummary): boolean {
  return a !== null && a.epoch === b.epoch && a.revision === b.revision && a.items === b.items;
}

function createCoalescer(timers: EventTimers, run: () => void): { request(): void; cancel(): void } {
  let cancelTimer: CancelTimer | undefined;
  return {
    request: () => { cancelTimer ??= timers.set(() => { cancelTimer = undefined; run(); }, READ_COALESCE_MS); },
    cancel: () => { cancelTimer?.(); cancelTimer = undefined; },
  };
}

function createPublisher(sink: UiEventSink): { focus(live: SidecarState["liveFocus"]): void; change(watch: WatchState, reasons: ChangeReason[]): void; forget(): void } {
  let lastContext: FocusContext | null = null, lastChange: ChangeSummary | null = null;
  return {
    focus: (live) => {
      if (!live) return;
      const context = focusContextOf(live);
      if (sameContext(lastContext, context)) return;
      lastContext = context;
      sink.publish({ type: "focus", focus: context });
    },
    change: (watch, reasons) => {
      const summary = { epoch: watch.epoch, revision: watch.revision, items: watch.items };
      const moved = !sameChange(lastChange, summary);
      lastChange = summary;
      if (moved) sink.publish({ type: "change", change: { ...summary, projectName: watch.projectName, reasons } });
    },
    forget: () => { lastContext = null; lastChange = null; },
  };
}

function noteHeartbeat(state: EventState, at: number): void {
  state.panel.lastSeenAt = at;
}

function observeStamp(state: EventState, watch: WatchState, at: number): void {
  if (watch.revision === null) { state.liveStamp = null; return; }
  state.liveStamp = { epoch: watch.epoch, revision: watch.revision, items: watch.items, at, ttlMs: EVENT_STAMP_TTL_MS };
  state.collection.observeLiveStamp(watch.epoch, watch.revision, 0, watch.items);
  state.catalogue.observeProjectEpoch(watch.epoch);
}

function confirmStill(state: EventState, still: EventOf<"still">, at: number): void {
  const stamp = state.liveStamp;
  const stale = !stamp || stamp.epoch !== still.epoch || stamp.revision !== still.revision;
  if (still.revision !== null && stale) state.liveStamp = { epoch: still.epoch, revision: still.revision, items: null, at, ttlMs: EVENT_STAMP_TTL_MS };
  else if (stamp) state.liveStamp = { ...stamp, at };
  if (state.liveFocus) state.liveFocus = { ...state.liveFocus, receivedAt: at, observedAt: at };
}

interface HostEventsDeps {
  state: EventState;
  receivers: Pick<InProcessReceivers, "acceptFocus">;
  sink?: UiEventSink;
  timers?: EventTimers;
}

function reportFocus(deps: Pick<HostEventsDeps, "state" | "receivers">, watch: WatchState, at: number): void {
  const { state, receivers } = deps, refused = (code: string | null): void => { state.eventLog("host.focus-refused", { code }); };
  void receivers.acceptFocus(jsonFieldsOf(focusBodyOf(watch, at))).then((outcome) => { if (outcome.outcome !== "succeeded") refused(outcome.errorCode ?? null); }, () => { refused(null); });
}

function onOverflow(state: EventState, overflow: EventOf<"overflow">): void {
  state.eventLog("host.events-overflow", { dropped: overflow.dropped });
  queueSnapshotRefresh(state, { reason: "overflow", read: { scope: "full" } });
}

/** The intake: `onEvent` turns each plugin event into the live stamp, the live focus, UI notifications and, when the project itself moved, one coalesced read. */
export function createHostEvents(deps: HostEventsDeps): HostEvents {
  const { state, receivers } = deps, listeners: ChangeListener[] = [], view = createPublisher(deps.sink ?? discardUiEvents);
  const scan = (): void => { tickReadScheduler(state, "event"); };
  const readWindow = createCoalescer(deps.timers ?? realTimers, scan);

  function onChange(watch: EventOf<"change">): void {
    const at = state.now().getTime();
    noteHeartbeat(state, at);
    observeStamp(state, watch, at);
    reportFocus({ state, receivers }, watch, at);
    view.focus(state.liveFocus);
    view.change(watch, watch.reason);
    for (const listener of listeners) listener(watch, watch.reason);
    if (watch.reason.some((reason) => !READ_FREE_REASONS.has(reason))) readWindow.request();
  }

  function onStill(still: EventOf<"still">): void {
    const at = state.now().getTime();
    noteHeartbeat(state, at);
    confirmStill(state, still, at);
    state.hostWake();
    if (state.awaitingFreshSnapshotAfterPair) scan();
  }

  function reset(): void {
    readWindow.cancel();
    view.forget();
    state.liveStamp = null;
  }

  function onEvent(event: PluginEvent): void {
    switch (event.event) {
      case "change": onChange(event); return;
      case "still": onStill(event); return;
      case "overflow": onOverflow(state, event); return;
      case "host-closing": reset(); return;
    }
  }

  return { onEvent, onChange: (listener) => { listeners.push(listener); }, scan, reset };
}
