// The shapes the decision evaluation passes around: labelled cases that can be put to a decision model, and what came back.
import type { AnyCore, Bands, DecisionModel, FailureReason } from "@extynt/decide";

/** The languages a case may be written in; English is the baseline and the others are reported separately. */
export type Language = "en" | "es" | "de" | "fr" | "ja" | "zh";

/** What a case is for the report: its language and whether it is one of the hard ones (a synonym, a negation, a near-duplicate, a multi-part request). */
export interface CaseTags {
  readonly lang: Language;
  readonly hard: boolean;
}

/** What a case may use: the decision models to ask and how long a request gets. */
export interface AskOptions {
  readonly models: ReadonlyArray<DecisionModel>;
  readonly decisionTimeoutMs: number;
}

/** What the model said about one case, before any routing: its core (null when it failed), why it failed, and what the call cost. */
export interface RawRun {
  readonly core: AnyCore | null;
  readonly failure: FailureReason | null;
  readonly latencyMs: number;
  readonly inputTokens: number | null;
}

/** One labelled case of a spec-based decision. */
export interface SpecCase {
  readonly id: string;
  readonly tags: CaseTags;
  readonly expected: string;
  readonly deterministic: AnyCore;
  readonly abstained: boolean;
  readonly high: boolean;
  readonly preference: Readonly<Partial<Record<string, number>>> | undefined;
  readonly bands: Bands;
  readonly reversible: boolean;
  vetoes(model: AnyCore): boolean;
  readonly guarded: ReadonlyArray<string>;
  cost(answer: string): number;
  ask(options: AskOptions, reversed: boolean): Promise<RawRun>;
}

/** A decision's labelled cases. */
export interface SpecSuite {
  readonly name: string;
  readonly cases: ReadonlyArray<SpecCase>;
}

/** What one end-to-end resolution did: the key it picked, how many requests it took, whether the shortlist held the wanted key, and what it cost. */
export interface ResolveRun {
  readonly key: string;
  readonly rounds: number;
  readonly requests: number;
  readonly held: boolean;
  readonly latencyMs: number;
  readonly failures: number;
}

/** One labelled end-to-end resolution over a catalogue of a given size. */
export interface ResolveCase {
  readonly id: string;
  readonly tags: CaseTags;
  readonly expected: string;
  resolve(options: AskOptions): Promise<ResolveRun>;
}

/** A tournament decision's cases over one catalogue size. */
export interface ResolveSuite {
  readonly name: string;
  readonly size: number;
  readonly cases: ReadonlyArray<ResolveCase>;
}
