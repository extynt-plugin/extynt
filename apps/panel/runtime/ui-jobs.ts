/** The sidecar's activity payloads as decoders: the jobs it is working on, their checklists, and the MCP calls outside agents make. */
import type { Decoder, Infer } from "@extynt/decode";
import { jobIdDecoder, planIdDecoder } from "./ids.js";
import { fallback, literal, map, number, object, skippingInvalid, string } from "@extynt/decode";

const MAX_JOB_PLANS = 30;
const MAX_WAITS = 50;
const MAX_CHECKLIST_ENTRIES = 200;
const MAX_SPECIALISTS = 12;
const MAX_CALL_PLANS = 8;

const waitDecoder = object({ from: string(), to: fallback(string(), null) });

const checklistItemDecoder = object({
  id: string(),
  title: fallback(string(), ""),
  phase: fallback(string(), ""),
  status: literal("open", "verified", "unbuilt"),
  verifiedAt: fallback(string(), null),
});

const checklistPhaseDecoder = object({ name: string(), verified: fallback(number(), 0), total: fallback(number(), 0) });

const checklistDecoder = fallback(object({
    items: fallback(skippingInvalid(checklistItemDecoder, MAX_CHECKLIST_ENTRIES), []),
    phases: fallback(skippingInvalid(checklistPhaseDecoder, MAX_CHECKLIST_ENTRIES), []),
    current: fallback(string(), null),
  }), null);

const specialistDecoder = map(
  object({
    role: string(),
    state: literal("running", "done", "failed"),
    startedAt: fallback(string(), ""),
    elapsedMs: fallback(number(), null),
    label: fallback(string(), null),
  }),
  (specialist) => ({ ...specialist, label: specialist.label ?? specialist.role }),
);

const jobDecoder = object({
  jobId: jobIdDecoder,
  requestId: string(),
  goal: fallback(string(), ""),
  status: literal("working", "applying", "waiting-apply", "waiting"),
  via: fallback(literal("request", "self-continue", "apply-resume"), "request"),
  activity: fallback(string(), ""),
  cycle: fallback(number(), 0),
  step: fallback(number(), 0),
  plansApplied: fallback(number(), 0),
  plansNotApplied: fallback(number(), 0),
  requestOpen: fallback(literal(true), false),
  plans: fallback(map(skippingInvalid(planIdDecoder), (kept) => kept.slice(0, MAX_JOB_PLANS)), []),
  startedAt: fallback(string(), ""),
  waits: fallback(skippingInvalid(waitDecoder, MAX_WAITS), []),
  checklist: checklistDecoder,
  specialists: fallback(skippingInvalid(specialistDecoder, MAX_SPECIALISTS), []),
});

/** A workflow job the sidecar is working on, whichever request started it. `requestId` is what steering messages are addressed to. */
export type UiJob = Infer<typeof jobDecoder>;
/** A stretch the job spent waiting for the user's Apply; `to` is null while it is still waiting. */
export type UiWait = Infer<typeof waitDecoder>;
/** One checklist entry; `verifiedAt` is set once, when the item first got a verified stage. */
export type UiChecklistItem = Infer<typeof checklistItemDecoder>;
/** The job's checklist; `current` is the first open item id, or null. */
export type UiChecklist = NonNullable<Infer<typeof checklistDecoder>>;
/** A specialist the job started; `elapsedMs` is final for done and failed rows and null while it runs. */
export type UiSpecialist = Infer<typeof specialistDecoder>;

/** The jobs of an activity answer (the bootstrap's or the stream's); malformed jobs are dropped and anything else reads as none. */
export const jobsDecoder: Decoder<ReadonlyArray<UiJob>> = fallback(map(object({ jobs: fallback(skippingInvalid(jobDecoder), []) }), (activity) => activity.jobs), []);

const mcpCallDecoder = object({
  id: number(),
  rev: fallback(number(), 0),
  at: fallback(string(), ""),
  tool: string(),
  client: fallback(string(), "agent"),
  args: fallback(string(), ""),
  state: fallback(literal("running", "ok", "error"), "running"),
  code: fallback(string(), null),
  ms: fallback(number(), null),
  planIds: fallback(map(skippingInvalid(planIdDecoder), (kept) => kept.slice(0, MAX_CALL_PLANS)), []),
});

/** One tool call an external agent made over MCP. */
export type UiMcpCall = Infer<typeof mcpCallDecoder>;

/** The MCP calls of an `mcp` event; malformed calls are dropped. */
export const mcpCallsDecoder: Decoder<ReadonlyArray<UiMcpCall>> = fallback(map(object({ calls: fallback(skippingInvalid(mcpCallDecoder), []) }), (event) => event.calls), []);
