// The host's record of an apply that never returned: read from a probe snapshot, logged once, charged to the operation that was running and used to settle the plan.
import type { InterruptedApply } from "./interrupted-apply-wire.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import type { ProbeSnapshot } from "./server-probe-wire.js";

const QUIT_MESSAGE = "After Effects quit while applying this batch. The project may be partly changed, or back at its last save. Refresh and inspect before trying again.";

function chargeOperation(deps: HttpRoutesDeps, interrupted: InterruptedApply): void {
  const key = `${interrupted.planId}:${interrupted.startedAt ?? ""}:${interrupted.index}`;
  if (deps.state.reportedInterruptedApplies.has(key)) return;
  deps.state.reportedInterruptedApplies.add(key);
  deps.dispatch.logPlanEvent("host.apply-interrupted", { ...interrupted });
  if (interrupted.operation) deps.dispatch.recordRuntimeEvidence([{ type: interrupted.operation, outcome: "readback_mismatch", basis: "host-quit-during-apply" }], undefined);
}

/** Logged once per interrupted apply, and charged to the operation After Effects was running, so the next briefing steers away from repeating it the same way. */
export function noteInterruptedApply(deps: HttpRoutesDeps, parsed: ProbeSnapshot): void {
  const interrupted = parsed.result.interruptedApply;
  if (!interrupted) return;
  chargeOperation(deps, interrupted);
  const batch = deps.state.workflowCoordinator.batchForPlan(interrupted.planId);
  const workflowHostClaimed = batch?.lifecycle === "claimed" || batch?.lifecycle === "executing";
  deps.dispatch.failUnsettledPlan(interrupted.planId, "HOST_QUIT_DURING_APPLY", QUIT_MESSAGE, workflowHostClaimed);
  deps.state.latestInterruptedApply = interrupted;
}
