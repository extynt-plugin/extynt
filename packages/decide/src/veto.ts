// Answers a model may not overrule: a yes from a spec's own strict rule is kept against the model's no.
import type { Failure } from "./port.js";
import type { AnyCore } from "./result.js";
import type { AnySpec } from "./spec.js";

const STRICT_YES: ReadonlySet<string> = new Set(["review-proven"]);

function saysYes(core: AnyCore): boolean {
  return "value" in core && core.value;
}

function saysNo(core: AnyCore): boolean {
  return "value" in core && !core.value;
}

/** The failure that keeps the deterministic answer when the strict yes of a yes or no decision named in STRICT_YES stands against the model's no, else null. */
export function vetoFor(spec: AnySpec<never>, deterministic: AnyCore, model: AnyCore): Failure | null {
  if (spec.kind !== "binary" || !STRICT_YES.has(spec.name)) return null;
  if (!saysYes(deterministic) || !saysNo(model)) return null;
  return { reason: "disagreement", detail: "The spec's own strict rule says yes, and a model's no does not overrule it." };
}
