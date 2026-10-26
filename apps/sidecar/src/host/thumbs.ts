// A plan's before and after thumbnails (default on, owner 2026-10-04). They are taken off the apply's critical path: a capture
// waits for the lane to be idle (`next`, offered by read-claims.ts) so the 30 ms apply and verify never queue behind a frame render.
// A `before` picture can only be taken before the apply, so a caller that wants one asks with urgency "ahead", which puts the
// capture at the front of the mailbox and costs the apply a frame render.
import type { SidecarState } from "../server-state.js";
import type { Opaque } from "../snapshot-view.js";
import type { HostWorkData } from "./lane-types.js";
import { thumbTargetFor, type ThumbTarget } from "./thumb-target.js";
import type { FrameSide } from "./ui-events.js";
import { enqueueHostWorkAhead } from "./work-queue.js";

const MAX_PENDING = 8;
const UNAPPLIED: ReadonlySet<string> = new Set(["draft", "prepared", "presented"]);

interface ThumbRequest { planId: string; side: FrameSide; operations: Opaque; urgency?: "idle" | "ahead" }
interface ThumbDeps { state: Pick<SidecarState, "agentMailbox" | "hostWake" | "latest" | "now" | "plans">; enabled?: () => boolean }
interface CaptureJob { id: string; item: HostWorkData }
interface Pending extends CaptureJob { planId: string; side: FrameSide }

/**
 * The lane's thumbnail queue. `queue` takes a request (the plan's operations, as stored or compiled, decide whether a frame
 * could show the change and which composition to take; urgency "ahead" goes before the queued work) and says false when
 * thumbnails are off, the plan shows nothing a frame could show, or the snapshot cannot say what to take. `next` takes the
 * oldest pending capture out of the queue for the lane to run as a `capture_frame` item, dropping a "before" whose plan has
 * been approved, since a picture taken now would show the plan's result. `drop` forgets a capture still waiting for an idle
 * lane; one already running is not stopped.
 */
export interface ThumbService {
  queue(request: ThumbRequest): boolean;
  next(): CaptureJob | undefined;
  drop(planId: string, side: FrameSide): void;
}

let counter = 0;

function captureId(planId: string, side: FrameSide, now: number): string {
  counter += 1;
  return `thumb-${side}-${planId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 48)}-${now.toString(36)}${counter.toString(36)}`;
}

function jobFor(request: ThumbRequest, target: ThumbTarget, now: number): CaptureJob {
  const id = captureId(request.planId, request.side, now);
  const command = { operation: "capture_frame", captureId: id, compositionId: target.compositionId, time: target.time, width: target.width, height: target.height, format: "png", keepResolution: true };
  return { id, item: { kind: "capture_frame", command, thumb: { planId: request.planId, side: request.side }, ...(target.background ? { background: target.background } : {}) } };
}

export function createThumbService(deps: ThumbDeps): ThumbService {
  const { state } = deps, pending: Pending[] = [];
  const stale = (entry: Pending): boolean => entry.side === "before" && !UNAPPLIED.has(state.plans.get(entry.planId)?.status ?? "");
  return {
    queue(request) {
      if (deps.enabled && !deps.enabled()) return false;
      const target = state.latest ? thumbTargetFor(request.operations, state.latest.snapshot) : null;
      if (!target) return false;
      const job = jobFor(request, target, state.now().getTime());
      if (request.urgency === "ahead") { enqueueHostWorkAhead(state, { approvedData: job.item }); return true; }
      pending.push({ ...job, planId: request.planId, side: request.side });
      while (pending.length > MAX_PENDING) pending.shift();
      state.hostWake();
      return true;
    },
    next() {
      for (let entry = pending.shift(); entry; entry = pending.shift()) if (!stale(entry)) return { id: entry.id, item: entry.item };
      return undefined;
    },
    drop(planId, side) {
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const entry = pending[index];
        if (entry?.planId === planId && entry.side === side) pending.splice(index, 1);
      }
    },
  };
}
