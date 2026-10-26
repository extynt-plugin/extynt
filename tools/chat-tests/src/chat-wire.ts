/**
 * The sidecar's chat answer as the harness reads it. Every member is optional and read leniently: a member of the wrong type
 * counts as absent and a malformed row is skipped, because a run reports what the agent did rather than failing on a shape.
 */
import { boolean, map, number, object, rawJson, string, union } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import { wireObject } from "@extynt/fake-plugin";
import { lenient, skippingInvalid } from "./lenient.js";
import { stringList } from "./string-list.js";
import type { WireObject } from "./wire-types.js";

/** One tool call the agent made and whether it was admitted. */
export interface ToolTrace { name: string; ok: boolean; code?: string | undefined; message?: string | undefined }

/** One plan the turn reported: its id, title and the operation lines the panel shows. */
export interface PlanCard { planId: string; title: string; operations: string[]; warnings?: string[] | undefined }

interface ChatBody {
  outcome?: string | undefined;
  steps?: number | undefined;
  stopReason?: string | undefined;
  usage?: WireObject | undefined;
  provider?: WireObject | undefined;
  model?: string | undefined;
  answer?: string | undefined;
  notes?: string[] | undefined;
  tools?: ToolTrace[] | undefined;
  plans?: PlanCard[] | undefined;
  failure?: WireObject | undefined;
}

/** A chat answer with the HTTP status it came with; status 0 is a transport failure that never reached the sidecar. */
export interface ChatResponse { status: number; body: ChatBody }

const toolTrace: Decoder<ToolTrace> = object({ name: string(), ok: boolean(), code: lenient(string()), message: lenient(string()) });
const planCard: Decoder<PlanCard> = object({ planId: string(), title: string(), operations: stringList, warnings: lenient(stringList) });

const chatBody: Decoder<ChatBody> = object({
  outcome: lenient(string()),
  steps: lenient(number()),
  stopReason: lenient(string()),
  usage: lenient(wireObject),
  provider: lenient(wireObject),
  model: lenient(string()),
  answer: lenient(string()),
  notes: lenient(stringList),
  tools: lenient(skippingInvalid(toolTrace)),
  plans: lenient(skippingInvalid(planCard)),
  failure: lenient(wireObject),
});

/** Decodes a chat answer; anything that is not an object reads as an answer with no members. */
export const chatBodyOf: Decoder<ChatBody> = union(chatBody, map(rawJson(), (): ChatBody => ({})));
