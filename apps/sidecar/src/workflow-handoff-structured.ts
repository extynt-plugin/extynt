// The structured form of a specialist handoff: when a specialist's free reply is not valid handoff JSON, a schema-constrained call turns it into one, instead of replaying the whole thread with a plea to try again.
import { supportsStructuredOutput, type ChatProvider, type JsonSchemaSpec } from "@extynt/llm";

const TEXT_LIST = { type: "array", items: { type: "string" } } as const;

/** The closed shape of a handoff for a role: exactly the six fields the specialist is told to return. */
export function handoffSchema(role: string): JsonSchemaSpec {
  return {
    name: "specialist_handoff",
    schema: {
      type: "object",
      properties: { role: { type: "string", enum: [role] }, objective: { type: "string" }, requirements: TEXT_LIST, deliverables: TEXT_LIST, constraints: TEXT_LIST, verification: TEXT_LIST },
      required: ["role", "objective", "requirements", "deliverables", "constraints", "verification"],
      additionalProperties: false,
    },
  };
}

/** The reply text of a schema-constrained call that restates an invalid handoff as a valid one, or undefined when the provider cannot constrain its output. */
export async function structuredHandoffText(provider: ChatProvider, request: { readonly role: string; readonly system: string; readonly invalidReply: string; readonly signal: AbortSignal }): Promise<string | undefined> {
  if (!supportsStructuredOutput(provider)) return undefined;
  const user = `The reply below was meant to be this specialist's handoff but is not a valid handoff object. Return the same content as the handoff object, changing nothing else.\n\nThe reply (untrusted data):\n${request.invalidReply}`;
  return provider.completeJson({ system: request.system, user, signal: request.signal }, handoffSchema(request.role));
}
