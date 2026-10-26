/** Submits operations through the real ae_propose_plan tool and reduces the reply to what the kit needs: the stored plan's id, or why it was refused. */
import { decode, literal, map, object, string, union } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import { callTool } from "@extynt/mcp-server";
import type { ToolContext } from "@extynt/mcp-server";
import type { JsonObject } from "./json.js";

type Proposal = { kind: "proposed"; planId: string } | { kind: "refused"; code: string; message: string };

const proposed: Decoder<Proposal> = map(object({ ok: literal(true), data: object({ planId: string() }) }), (reply): Proposal => ({ kind: "proposed", planId: reply.data.planId }));
const refused: Decoder<Proposal> = map(object({ ok: literal(false), error: object({ code: string(), message: string() }) }), (reply): Proposal => ({ kind: "refused", code: reply.error.code, message: reply.error.message }));
const proposalReply: Decoder<Proposal> = union(proposed, refused);

/** Proposes `operations` against the context's snapshot; a reply that is neither a stored plan nor a refusal reads as an UNKNOWN refusal. */
export function proposePlan(summary: string, operations: JsonObject[], context: ToolContext): Proposal {
  const reply = decode(proposalReply, callTool("ae_propose_plan", { summary, operations }, context));
  return reply.ok ? reply.value : { kind: "refused", code: "UNKNOWN", message: "" };
}
