/** The exact record kinds a turn trace holds; every record is one of these, plus its sequence number and time. */
import type { WireObject, WireValue } from "./wire-types.js";

/** A value, or null where it is absent. */
export function orNull<T>(value: T | undefined): T | null {
  return value ?? null;
}

/** One piece of the system briefing the provider was sent. */
export interface SystemSegment { text: string; cache?: boolean | undefined }

/** A tool the model was offered. */
export interface ToolOffer { name?: string | undefined; description?: string | undefined }

/** A tool result whose text got shorter between two steps, which is how a context fold shows. */
export interface FoldedMessage { position: number; beforeChars: number; afterChars: number }

interface PlanSummary { planId?: string | undefined; title?: string | undefined }

/** What the model was asked, recorded when a turn starts. */
export interface TurnStartBody { kind: "turn.start"; message: string; requestId: string; history?: WireValue[] | undefined }

/** One request to the model: the messages appended since the last step, and on the first step the briefing and tools. */
export interface StepRequestBody {
  kind: "step.request";
  step: number;
  messageCount: number;
  delta: WireValue[];
  system?: SystemSegment[] | undefined;
  tools?: ToolOffer[] | undefined;
}

/** What the model answered to one request. */
export interface StepReplyBody {
  kind: "step.reply";
  step: number;
  durationMs: number | undefined;
  text: string;
  reasoning: string;
  toolCalls: WireValue[];
  finishReason: string | null;
  usage: WireObject | null;
}

interface ContextFoldBody { kind: "context.fold"; messages: FoldedMessage[] }

/** How a turn ended, as the sidecar's chat answer reported it. */
export interface TurnEndBody {
  kind: "turn.end";
  status: number;
  outcome: string | null;
  steps: number | null;
  stopReason: string | null;
  usage: WireObject | null;
  provider: WireObject | null;
  model: string | null;
  plans: PlanSummary[];
  notes: string[] | null;
  failure: WireObject | null;
  answer: string;
}

interface SidecarLogBody { kind: "sidecar.log"; line: WireObject }

/** What a record says, without its sequence number and time. */
export type TraceBody = TurnStartBody | StepRequestBody | StepReplyBody | ContextFoldBody | TurnEndBody | SidecarLogBody;

/** A recorded event: the body plus where it fell in the turn and when. */
export type TraceRecord = TraceBody & { seq: number; at: string };
