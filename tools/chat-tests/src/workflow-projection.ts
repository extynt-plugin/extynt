/** The workflow status surface the plugin-transport tests and waits read, decoded from `/v1/workflow/status`. */
import { array, boolean, map, nullable, number, object, string } from "@extynt/decode";
import type { Decoder, Infer } from "@extynt/decode";
import { wireObject, wireValue } from "@extynt/fake-plugin";

const batch = object({
  batchId: string(),
  jobId: string(),
  stageId: string(),
  dependencies: array(string()),
  lifecycle: string(),
  execution: string(),
  verification: string(),
  mutation: string(),
});

const projection = object({
  resumeSupported: boolean(),
  activeJobId: nullable(string()),
  activeDispatchLease: wireValue,
  jobs: array(object({ jobId: string(), status: string(), blocker: nullable(string()), providerCycle: number() })),
  stages: array(object({ stageId: string(), status: string(), batchIds: array(string()) })),
  batches: array(batch),
  providerFailures: array(object({ code: string(), message: string(), afterSeal: boolean() })),
  divergences: array(wireValue),
  continuation: nullable(wireObject),
});

/** The workflow projection as `/v1/workflow/status` reports it. */
export type WorkflowProjection = Infer<typeof projection>;

/** Decodes a `/v1/workflow/status` body down to the projection these tests assert on. */
export const workflowProjectionOf: Decoder<WorkflowProjection> = map(object({ projection }), (body) => body.projection);
