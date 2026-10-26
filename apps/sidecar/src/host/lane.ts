// The host lane: drains the work queue against the plugin, one claimed item at a time, and hands each to the runner registered for its kind.
// Concurrency model: a single drain loop runs at a time (`running`). Any number of wakes while it runs collapse into one more
// pass (`again`). The loop claims in a fixed order: the readers' urgent pages, an approval the sidecar owes, the next queued item
// (with the guards of the HTTP claim: quarantine, awaiting snapshot, workflow refusals, stale undo), then background reads. A
// claimed item runs to its settlement before the next claim, so a native lease is never reserved while another is open. Event driven:
// woken by an enqueue, by any sidecar change and by the link coming up; there is no polling timer.
import type { PluginClient } from "@extynt/host-native";
import type { InProcessReceivers } from "../receiver-types.js";
import type { MailboxClaimOutcome } from "../server-panel-lease.js";
import type { PanelState } from "../server-types.js";
import type { SidecarState } from "../server-state.js";
import { autoApproveReady } from "./auto-approve.js";
import type { ReadyApprover } from "./auto-approve.js";
import { isHostWorkKind } from "./lane-types.js";
import type { HostLaneContext, HostRunner, HostRunnerRegistry, HostRunnerTable, HostWorkData, HostWorkKind, LogFields } from "./lane-types.js";
import type { HostLinkController } from "./link.js";
import type { HostReaders } from "./readers.js";
import { stallAware, type ReadyRetry } from "./stall-client.js";

/** Starts and stops the lane, wakes it, and says when it is idle (a test and shutdown aid: it resolves once everything claimable has been drained). */
export interface HostLaneController {
  readonly registry: HostRunnerRegistry;
  start(): void;
  stop(): void;
  wake(): void;
  idle(): Promise<void>;
}

interface HostLaneDeps {
  state: SidecarState;
  link: HostLinkController;
  receivers: InProcessReceivers;
  claims: { claimHostItem(): MailboxClaimOutcome; settleHostFlight(): boolean };
  approve: ReadyApprover;
  readers: Pick<HostReaders, "claimAhead" | "claimBackground" | "capturePlan" | "hashes">;
  readyRetry?: ReadyRetry;
  afterItem?: () => void;
}

interface Claimed { kind: string; data: HostWorkData }
type NextStep = Claimed | "progressed" | "idle";

function panelBusyWith(panel: PanelState, kind: string | null, now: number): PanelState {
  return kind === null ? { ...panel, busy: false, busyKind: null, busySinceAt: null } : { ...panel, busy: true, busyKind: kind, busySinceAt: now };
}

class NativeHostLane implements HostLaneController {
  private readonly runners = new Map<HostWorkKind, HostRunner>();
  readonly registry: HostRunnerTable = { runners: this.runners, register: (kind, runner) => { this.runners.set(kind, runner); } };
  private running = false;
  private again = false;
  private stopped = true;
  private current: Promise<void> = Promise.resolve();
  private watched: { client: PluginClient; wrapped: PluginClient } | undefined;
  private readonly deps: HostLaneDeps;

  constructor(deps: HostLaneDeps) { this.deps = deps; }

  private readonly onChange = (): void => {
    if (this.stopped) return;
    this.deps.state.changeWaiters.add(this.onChange);
    this.wake();
  };

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.deps.state.hostWake = () => this.wake();
    this.deps.state.changeWaiters.add(this.onChange);
    this.wake();
  }

  stop(): void {
    this.stopped = true;
    this.deps.state.changeWaiters.delete(this.onChange);
    this.deps.state.hostWake = () => undefined;
  }

  wake(): void {
    if (this.stopped) return;
    if (this.running) { this.again = true; return; }
    this.running = true;
    this.current = this.drain();
  }

  async idle(): Promise<void> {
    while (this.running) await this.current;
  }

  private log(event: string, fields: LogFields): void {
    this.deps.state.eventLog(event, fields);
  }

  private async drain(): Promise<void> {
    try {
      do {
        this.again = false;
        let progressed = true;
        while (progressed && !this.stopped) progressed = await this.step();
      } while (this.again && !this.stopped);
    } catch (error) {
      this.log("host.lane-failed", { message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.running = false;
    }
  }

  private async step(): Promise<boolean> {
    const status = this.deps.link.status();
    if (!this.deps.link.client() || (status.state !== "online" && status.state !== "stalled")) return false;
    const next = await this.nextStep();
    if (typeof next === "string") return next === "progressed";
    await this.run(next);
    return true;
  }

  private async nextStep(): Promise<NextStep> {
    const { state, readers, approve, claims } = this.deps, now = state.now().getTime();
    const ahead = readers.claimAhead(now);
    if (ahead) return { kind: ahead.kind, data: ahead.item };
    if (await autoApproveReady({ state, approve, log: (event, fields) => this.log(event, fields) })) return "progressed";
    const claim = claims.claimHostItem();
    if (claim.kind === "item") return { kind: claim.claim.kind, data: claim.data };
    if (claim.kind !== "empty") return claim.kind === "refused" ? "progressed" : "idle";
    const background = readers.claimBackground(now);
    return background ? { kind: background.kind, data: background.item } : "idle";
  }

  private context(): HostLaneContext | undefined {
    const client = this.deps.link.client();
    if (!client) return undefined;
    const { state, receivers, link, readers } = this.deps;
    if (this.watched?.client !== client) this.watched = { client, wrapped: stallAware(client, link, this.deps.readyRetry) };
    return {
      client: this.watched.wrapped, state, receivers, link, hashes: readers.hashes, now: () => state.now().getTime(), log: (event, fields) => this.log(event, fields),
      capturePlan: (planId, side, urgency) => readers.capturePlan(planId, side, urgency),
    };
  }

  private markBusy(kind: string): void {
    const { state, link } = this.deps;
    state.panel = panelBusyWith(state.panel, kind, state.now().getTime());
    link.setBusy(isHostWorkKind(kind) ? kind : null);
  }

  private markIdle(): void {
    const { state, link } = this.deps;
    if (state.panel.busy) state.panelIdleSince = state.now().getTime();
    state.panel = panelBusyWith(state.panel, null, 0);
    link.setBusy(null);
  }

  private async execute(work: Claimed): Promise<void> {
    const runner = isHostWorkKind(work.kind) ? this.runners.get(work.kind) : undefined, context = this.context();
    if (runner && context) await runner(work.data, context);
    else this.log("host.runner-missing", { kind: work.kind });
  }

  private async run(work: Claimed): Promise<void> {
    const id = this.deps.state.inFlight?.id ?? work.kind;
    this.markBusy(work.kind);
    try {
      await this.execute(work);
    } catch (error) {
      this.log("host.runner-failed", { kind: work.kind, id, message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.markIdle();
      if (this.deps.claims.settleHostFlight()) this.log("host.flight-unsettled", { kind: work.kind, id });
      this.log("host.item-done", { kind: work.kind, id });
      this.deps.afterItem?.();
    }
  }
}

/** Builds the lane; call `start` to begin draining. */
export function createHostLane(deps: HostLaneDeps): HostLaneController {
  return new NativeHostLane(deps);
}
