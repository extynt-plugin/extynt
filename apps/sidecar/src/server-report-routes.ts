// The read-only reports a caller may ask for (diagnostics export, latest receipts, job status), and the refusals of the mutation endpoints this sidecar does not have.
import { isWorkflowId } from "@extynt/workflow";

import type { HttpRoutesDeps } from "./server-http-state.js";
import { jobStatusOf } from "./server-job-status.js";
import { ok, refuse, route, type MountedRoute } from "./server-route-table.js";

const RECEIPTS_LISTED = 50;
const READ_ONLY = refuse(405, "READ_ONLY", "This sidecar exposes no mutation or execution endpoint.");

function inventoryReport(state: HttpRoutesDeps["state"]) {
  const { inventory, previousInventory } = state;
  if (!inventory) return null;
  return { fingerprint: inventory.fingerprint, itemCount: inventory.items.length, truncated: inventory.truncated, diff: previousInventory ? { previousFingerprint: previousInventory.fingerprint } : null };
}

function diagnosticsExport(state: HttpRoutesDeps["state"]) {
  const { latest } = state;
  return {
    schemaVersion: "0.1",
    exportedAt: state.now().toISOString(),
    environment: { service: "sidecar", loopbackOnly: true, node: process.version },
    host: latest?.snapshot.result.runtime ?? null,
    snapshot: latest ? { requestId: latest.snapshot.requestId, receivedAt: latest.receivedAt, bytes: latest.bytes } : null,
    inventory: inventoryReport(state),
    diagnostics: { preflightCount: state.preflightCount, snapshotPostCount: state.snapshotPostCount },
  };
}

/** Diagnostics export, the latest receipts and job status, plus the 405 answer for the execute and mutate endpoints. */
export const reportRoutes: readonly MountedRoute[] = [
  route({ method: "GET", path: "/v1/diagnostics/export", handle: ({ deps }) => ok(diagnosticsExport(deps.state)) }),
  route({ method: "GET", path: "/v1/receipts/latest", handle: ({ deps }) => ok({ ok: true, latest: deps.state.receipts.at(-1) ?? null, receipts: deps.state.receipts.slice(-RECEIPTS_LISTED) }) }),
  route({
    method: "GET",
    path: "/v1/workflow/status",
    handle: ({ deps, url }) => {
      const jobId = url.searchParams.get("jobId") ?? undefined;
      if (jobId !== undefined && !isWorkflowId(jobId)) return refuse(422, "INVALID_JOB_ID", "jobId must match the bounded workflow ID contract.");
      return ok(jobStatusOf(deps, jobId));
    },
  }),
  route({ method: "POST", path: "/execute", handle: () => READ_ONLY }),
  route({ method: "POST", path: "/mutate", handle: () => READ_ONLY }),
  route({ method: "POST", path: "/v1/execute", handle: () => READ_ONLY }),
];
