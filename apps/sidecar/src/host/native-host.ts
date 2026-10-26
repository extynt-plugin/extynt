// The native host as the composition root builds it: the link to the plugin and the lane that drains the host work queue through it.
import { defaultDiscoveryPath } from "@extynt/host-native";
import type { InProcessReceivers } from "../receiver-types.js";
import type { SidecarState } from "../server-state.js";
import type { MailboxClaimOutcome } from "../server-panel-lease.js";
import type { ReadyApprover } from "./auto-approve.js";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { wireUndoAvailability } from "./undo-availability.js";
import { bindUiHost, thumbsEnabledFor, uiEventSinkFor } from "../ui-host.js";
import { uiEventsFor } from "../ui-events.js";
import { createHostLane } from "./lane.js";
import type { HostLaneController } from "./lane.js";
import { createHostLink } from "./link.js";
import { createHostReaders, type HostReaders } from "./readers.js";
import type { HostLinkController } from "./link.js";
import { registerHostRunners } from "./runners.js";

/** The running host: the link, the lane, and the readers (events, thumbnails, read runners). */
export interface NativeHost {
  link: HostLinkController;
  lane: HostLaneController;
  readers: HostReaders;
  start(): void;
  stop(): void;
}

interface NativeHostDeps {
  state: SidecarState;
  receivers: InProcessReceivers;
  claims: { claimHostItem(): MailboxClaimOutcome; settleHostFlight(): boolean };
  approve: ReadyApprover;
  current(): ProjectSnapshot | undefined;
  notifyChange(): void;
  wakeContinuations(): void;
}

/** Builds the link, the lane and the readers and wires them together; `start` and `stop` run both ends. */
export function createNativeHost(deps: NativeHostDeps): NativeHost {
  const { state } = deps;
  const readers = createHostReaders({ state, receivers: deps.receivers, sink: uiEventSinkFor(state), thumbsEnabled: thumbsEnabledFor(state) });
  bindUiHost(state, readers);
  const link = createHostLink({
    state, discoveryPath: state.options.discoveryPath ?? defaultDiscoveryPath(),
    watch: { intervalMs: 100, stillMs: 1000 },
    ...(state.options.hostCallTimeoutMs === undefined ? {} : { callTimeoutMs: state.options.hostCallTimeoutMs }),
    ...(state.options.hostStallAfterMs === undefined ? {} : { stallAfterMs: state.options.hostStallAfterMs }),
  });
  const lane = createHostLane({ state, link, receivers: deps.receivers, claims: deps.claims, approve: deps.approve, readers, afterItem: deps.wakeContinuations, ...(state.options.hostReadyRetry ? { readyRetry: state.options.hostReadyRetry } : {}) });
  readers.register(lane.registry);
  registerHostRunners(lane.registry);
  state.hostLink = link;
  state.hostFacts.capturePlan = (planId, side, urgency) => readers.capturePlan(planId, side, urgency);
  link.onEvent((event) => readers.events.onEvent(event));
  link.onConnected(() => readers.afterPair());
  link.onChange((status) => {
    if (status.state === "offline" || status.state === "closing") readers.events.reset();
    deps.notifyChange();
  });
  wireUndoAvailability({ onChange: (listener) => readers.events.onChange(listener), onRead: (listener) => readers.onRead(listener) }, { state, current: deps.current, publish: (event) => uiEventsFor(state).publish(event) });
  return {
    link, lane, readers,
    start: () => { lane.start(); link.start(); },
    stop: () => { link.stop(); lane.stop(); },
  };
}
