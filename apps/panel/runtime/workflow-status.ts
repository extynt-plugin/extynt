/** The shape of GET /v1/workflow/status: the durable projection of jobs and batches, the resume summary and any pause. */
import type { Infer } from "@extynt/decode";
import { pauseOrNull } from "./panel-pause.js";
import { fallback, jsonValue, literal, object, skippingInvalid, string } from "@extynt/decode";
import { wholeCount } from "./wire-decoders.js";


const jobDecoder = object({ jobId: fallback(string(), null), status: fallback(string(), ""), blocker: fallback(string(), "") });
const batchDecoder = object({
  jobId: fallback(string(), null),
  lifecycle: fallback(string(), ""),
  execution: fallback(string(), ""),
  verification: fallback(string(), ""),
  mutation: fallback(string(), ""),
});

const projectionDecoder = object({
  resumeSupported: fallback(literal(true), false),
  automaticDispatchResumeSupported: fallback(literal(true), false),
  activeJobId: fallback(string(), null),
  jobs: fallback(skippingInvalid(jobDecoder), []),
  batches: fallback(skippingInvalid(batchDecoder), []),
  providerFailures: fallback(skippingInvalid(object({ code: fallback(string(), ""), afterSeal: fallback(literal(true), false) })), []),
  divergences: fallback(skippingInvalid(jsonValue), []),
});

const resumeDecoder = object({
  needsInput: fallback(literal(true), false),
  automatic: fallback(literal(true), false),
  autoApply: fallback(literal(true), false),
  status: fallback(string(), ""),
  whyPaused: fallback(string(), ""),
  applied: fallback(object({ settledBatches: wholeCount, totalBatches: wholeCount, verifiedBatches: wholeCount, appliedUnverifiedBatches: wholeCount }), null),
  remaining: fallback(object({ criteria: wholeCount, batches: wholeCount }), null),
});

/** The durable record of the workflow engine's jobs and batches. */
export type WorkflowProjection = Infer<typeof projectionDecoder>;
/** What the engine says about continuing after a stop. */
export type WorkflowResume = Infer<typeof resumeDecoder>;

/** The status answer; null for a body that is not an object. */
export const workflowStatusDecoder = fallback(object({ projection: fallback(projectionDecoder, null), resume: fallback(resumeDecoder, null), pause: pauseOrNull }), null);
