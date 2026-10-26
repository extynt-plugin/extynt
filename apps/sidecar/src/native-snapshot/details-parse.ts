/** Narrows the text `aeReadPropertyDetails` returns. The jsx is the host's: a malformed answer is `ok: false`, never a partial one. */
import { decodeJson, type Infer, isNotJson } from "@extynt/decode";
import { detailsReply } from "./detail-shapes.js";
import type { PropertyDetailsResult } from "./types.js";

type Reply = Infer<typeof detailsReply>;

const refused = (code: string, message: string): PropertyDetailsResult => ({ ok: false, layers: [], error: { code, message } });
const unreadable = (message: string): PropertyDetailsResult => refused("DETAILS_UNREADABLE", message);

function reportedFailure(reply: Reply): PropertyDetailsResult {
  return refused(reply.error?.code ?? "DETAILS_FAILED", reply.error?.message ?? "The details call failed.");
}

function parsedReply(reply: Reply): PropertyDetailsResult {
  if (!reply.ok) return reportedFailure(reply);
  if (!reply.layers) return unreadable("The details call returned malformed layers.");
  if (reply.compositions === undefined) return { ok: true, layers: reply.layers };
  return reply.compositions ? { ok: true, layers: reply.layers, compositions: reply.compositions } : unreadable("The details call returned malformed composition markers.");
}

/** The details call's text as a result: its layers and composition markers, the failure it reported, or a refusal naming why it cannot be read. */
export function parsePropertyDetails(text: string): PropertyDetailsResult {
  const decoded = decodeJson(text, detailsReply);
  if (decoded.ok) return parsedReply(decoded.value);
  return unreadable(isNotJson(decoded.error) ? "The details call did not return JSON." : "The details call returned an unexpected shape.");
}
