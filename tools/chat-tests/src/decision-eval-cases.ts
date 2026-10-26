// Builds labelled spec cases: a spec, a state and the answer a designer expects, whatever the spec's kind, askable raw and with the label order reversed.
import { performance } from "node:perf_hooks";
import { abstains, decide, deterministicCore, vetoFor } from "@extynt/decide";
import type { AnyCore, AnySpec, Bands, DecisionImage, JsonValue } from "@extynt/decide";
import type { AskOptions, CaseTags, RawRun, SpecCase } from "./decision-eval-types.js";

const RAW_BANDS: Bands = { verify: 0, act: 0 };

const DEFAULT_THRESHOLD = 0.7;

type Expected = string | boolean | number | ReadonlyArray<string>;

function labelSetText(labels: Iterable<string>): string {
  const sorted = [...labels].sort();
  return sorted.length === 0 ? "(none)" : sorted.join(",");
}

/** The comparable text of an answer. */
export function answerText(core: AnyCore): string {
  if ("label" in core) return core.label;
  if ("labels" in core) return labelSetText(core.labels);
  if ("level" in core) return String(core.level);
  return String(core.value);
}

function expectedText(expected: Expected): string {
  return typeof expected === "string" ? expected : typeof expected === "boolean" || typeof expected === "number" ? String(expected) : labelSetText(expected);
}

function reversedSpec<S extends JsonValue>(spec: AnySpec<S>): AnySpec<S> {
  return spec.kind === "choice" ? { ...spec, labels: Object.fromEntries(Object.entries(spec.labels).reverse()) } : spec;
}

function bandsOf(spec: AnySpec<JsonValue>): Bands {
  const single = spec.threshold ?? DEFAULT_THRESHOLD;
  return spec.bands ?? { verify: single, act: single };
}

/** A labelled case for any spec; `ask` puts it to the models with every answer taken, and the case's `image` goes to the models that accept images. */
export function specCase<S extends JsonValue>(input: {
  id: string; tags: CaseTags; spec: AnySpec<S>; state: S; expected: Expected; misroute?: (answer: string) => number; image?: DecisionImage;
}): SpecCase {
  const { spec, state } = input;
  const deterministic = deterministicCore(spec, state);
  return {
    id: input.id,
    tags: input.tags,
    expected: expectedText(input.expected),
    deterministic,
    abstained: abstains(spec, deterministic),
    high: spec.stakes === "high",
    preference: spec.kind === "choice" ? spec.preference : undefined,
    bands: bandsOf(spec),
    reversible: spec.kind === "choice",
    vetoes: (model) => vetoFor(spec, deterministic, model) !== null,
    guarded: spec.kind === "choice" ? spec.guarded ?? [] : [],
    cost: (answer) => (answer === expectedText(input.expected) ? 0 : input.misroute?.(answer) ?? 1),
    async ask(options: AskOptions, reversed: boolean): Promise<RawRun> {
      const started = performance.now();
      const used = reversed ? reversedSpec(spec) : spec;
      const picture = input.image === undefined ? {} : { image: input.image };
      const result = await decide(state, { ...used, bands: RAW_BANDS }, { models: options.models, decisionTimeoutMs: options.decisionTimeoutMs, ...picture });
      const latencyMs = performance.now() - started;
      if (result.source === "deterministic") return { core: null, failure: result.fallback?.reason ?? null, latencyMs, inputTokens: null };
      return { core: result, failure: null, latencyMs, inputTokens: result.inputTokens };
    },
  };
}
