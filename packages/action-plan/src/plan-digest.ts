// The canonical content identity of a plan.
import { createHash } from "node:crypto";
import { stableStringify } from "@extynt/project-graph";
import { type JsonValue } from "@extynt/decode";
import { isJsonObject } from "./json-shape.js";
import type { PlanInput } from "./plan-types.js";
import { toJsonValue } from "./plain-json.js";

/** The sha256 of a plan's canonical JSON with its own digest fields removed: the identity validation and scoped read sets share. */
export function planDigestJson(plan: JsonValue): string {
  const json = toJsonValue(plan);
  const content = isJsonObject(json) ? Object.fromEntries(Object.entries(json).filter(([key]) => key !== "digest" && key !== "planDigest")) : json;
  return createHash("sha256").update(stableStringify(content)).digest("hex");
}

/** `planDigestJson` for a plan in a typed form, read as the JSON it would serialise to. */
export function computePlanDigest(plan: PlanInput): string { return planDigestJson(toJsonValue(plan) ?? null); }
