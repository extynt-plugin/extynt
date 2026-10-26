/** Waits that tie the sidecar to the fake plugin: until it has read the project the host holds, and until the work it owes the host is done. */
import { decodeOrThrow } from "@extynt/decode";
import type { FakePluginHost } from "./fake-plugin-host.js";
import type { SidecarHandle } from "./sidecar-client.js";
import { workflowProjectionOf, type WorkflowProjection } from "./workflow-projection.js";

const READ_DEADLINE_MS = 15_000;
const SETTLE_DEADLINE_MS = 5_000;
const QUIET_MS = 150;

const pause = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Resolves once the sidecar's latest snapshot was read at the host's current stamp. Returns why it did not, or undefined. */
export async function untilRead(sidecar: SidecarHandle, host: FakePluginHost, deadlineMs = READ_DEADLINE_MS): Promise<string | undefined> {
  const wanted = host.plugin.state.watch, deadline = Date.now() + deadlineMs;
  for (;;) {
    const read = await sidecar.latestStamp();
    if (read && read.epoch === wanted.epoch && read.revision === wanted.revision) return undefined;
    if (Date.now() > deadline) return `the sidecar did not read the fixture project from the fake plugin within ${deadlineMs / 1000}s`;
    await pause(20);
  }
}

/** The sidecar's workflow projection, read from `/v1/workflow/status`. */
export async function workflowOf(sidecar: SidecarHandle): Promise<WorkflowProjection> {
  const response = await fetch(`http://127.0.0.1:${sidecar.port}/v1/workflow/status`, { headers: { Authorization: `Bearer ${sidecar.token}` } });
  return decodeOrThrow(workflowProjectionOf, await response.json());
}

async function workflowIdle(sidecar: SidecarHandle): Promise<boolean> {
  try {
    const projection = await workflowOf(sidecar);
    return projection.activeDispatchLease === null && projection.batches.every((batch) => batch.lifecycle === "settled" || batch.lifecycle === "cancelled");
  } catch { return false; }
}

/**
 * The turn's answer can come back while the sidecar is still applying what it sealed, so a run waits for the work to finish:
 * every batch settled and the plugin unasked for a moment.
 */
export async function untilSettled(sidecar: SidecarHandle, host: FakePluginHost): Promise<void> {
  const deadline = Date.now() + SETTLE_DEADLINE_MS;
  let seen = host.plugin.requests.length, quietSince = Date.now();
  while (Date.now() < deadline) {
    await pause(25);
    if (host.plugin.requests.length !== seen) { seen = host.plugin.requests.length; quietSince = Date.now(); continue; }
    if (Date.now() - quietSince >= QUIET_MS && await workflowIdle(sidecar)) return;
  }
}

const ENDPOINT_READ_DEADLINE_MS = 30_000;
const WORKFLOW_IDLE_DEADLINE_MS = 60_000;

/** Resolves once the sidecar has read any project from the real plugin. Returns why it did not, or undefined. */
export async function untilEndpointRead(sidecar: SidecarHandle, deadlineMs = ENDPOINT_READ_DEADLINE_MS): Promise<string | undefined> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    if (await sidecar.latestStamp().catch(() => null)) return undefined;
    if (Date.now() > deadline) return `the sidecar did not read a project from the real plugin within ${deadlineMs / 1000}s: is the port-forward up and native.json current?`;
    await pause(200);
  }
}

/** Waits for the sidecar's own applying to finish when no fake plugin exists to watch; a real host can be slow, so the ceiling is generous. */
export async function untilWorkflowIdle(sidecar: SidecarHandle, deadlineMs = WORKFLOW_IDLE_DEADLINE_MS): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (await workflowIdle(sidecar)) return;
    await pause(200);
  }
}
