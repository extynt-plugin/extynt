// The sidecar's gateway to @extynt/decide: runs a batch of decisions through the configured models and records each settled decision; with no model configured nothing leaves the machine.
import { decideAll, resolveFont, tournamentChoice, type CallUsage, type FontRecord, type Habits, type AnyCore, type Bands, type Candidate, type TournamentOptions, type TournamentResult, type BinarySpec, type Decisions, type DecisionModel, type JsonValue, type Provenance, type ResultsOf, fittedBands, withFittedBands } from "@extynt/decide";
import { BatchCalls, rowTokens } from "./decision-calls.js";
import type { DecisionLog, DecisionLogRow, DecisionSite } from "./decision-log.js";
import { currentRequestId } from "./request-scope.js";

interface DecisionUsageSink {
  addDecisions(requestId: string, calls: ReadonlyArray<CallUsage>): void;
}

interface DecisionServiceOptions {
  readonly models: () => ReadonlyArray<DecisionModel>;
  readonly log: DecisionLog;
  readonly now: () => Date;
  readonly clockMs?: () => number;
  readonly usage?: DecisionUsageSink;
}

type Settled = AnyCore & Provenance;

interface SettledFields {
  readonly at: string;
  readonly latencyMs: number;
  readonly site: DecisionSite;
  readonly questions: number;
}

function answerOf(result: Settled): string {
  if ("label" in result) return result.label;
  if ("labels" in result) return [...result.labels].join(",");
  if ("level" in result) return String(result.level);
  return String(result.value);
}

function rowOf(decision: string, result: Settled, fields: SettledFields, inputTokens: number | null): DecisionLogRow {
  return {
    at: fields.at,
    decision,
    moment: fields.site.moment,
    jobId: fields.site.jobId,
    questions: fields.questions,
    image: result.imageSent,
    tier: result.source,
    provider: result.provider,
    answer: answerOf(result),
    confidence: result.confidence,
    band: result.band,
    abstained: result.abstained,
    fallback: result.fallback?.reason ?? null,
    latencyMs: fields.latencyMs,
    model: result.model,
    inputTokens,
  };
}

/** The name a batch entry is logged under: the key without the per-item suffix after a colon. */
export function loggedName(key: string): string {
  const colon = key.indexOf(":");
  return colon < 0 ? key : key.slice(0, colon);
}

function bandsOf(name: string): { readonly bands?: Bands } {
  const bands = fittedBands(name);
  return bands === undefined ? {} : { bands };
}

/** Runs decisions through the configured models and logs them, each row tagged with the moment and job that asked. */
export class DecisionService {
  public constructor(private readonly options: DecisionServiceOptions) {}

  public hasModels(): boolean {
    return this.options.models().length > 0;
  }

  public hasDecisionModel(): boolean {
    return this.options.models().some((model) => model.tier === "decision-model");
  }

  public async decideAll<S extends JsonValue, const D extends Decisions<S>>(state: S, decisions: D, site: DecisionSite, logAs?: string): Promise<ResultsOf<D>> {
    const started = this.nowMs();
    const calls = new BatchCalls();
    const results = await decideAll(state, decisions, { models: this.options.models(), ...(site.image === undefined ? {} : { image: site.image }), ...(site.signal === undefined ? {} : { signal: site.signal }), onCall: calls.note });
    const fields = this.fieldsOf(started, site, Object.keys(decisions).length);
    const entries = Object.entries<Settled>(results);
    const tokens = rowTokens(entries.map(([, result]) => result.provider), calls.list());
    this.options.log.record(entries.map(([key, result], index) => rowOf(logAs ?? loggedName(key), result, fields, tokens[index] ?? null)));
    this.countCalls(calls.list());
    return results;
  }

  public async settleBinary<S extends JsonValue>(spec: BinarySpec<S>, state: S, site: DecisionSite): Promise<boolean> {
    if (!this.hasModels()) return spec.deterministic(state);
    const { settled } = await this.decideAll(state, { settled: withFittedBands(spec) }, site, spec.name);
    return settled.value;
  }

  public async tournament(phrase: string, candidates: ReadonlyArray<Candidate>, options: TournamentOptions, site: DecisionSite): Promise<TournamentResult> {
    const started = this.nowMs();
    const calls = new BatchCalls();
    const result = await tournamentChoice(phrase, candidates, { ...options, ...bandsOf(options.name) }, { models: this.options.models(), onCall: calls.note });
    this.recordOne(options.name, result, this.fieldsOf(started, site, result.questions), calls.list());
    return result;
  }

  public async resolveFont(phrase: string, installed: ReadonlyArray<FontRecord>, habits: Habits | undefined, site: DecisionSite): Promise<TournamentResult> {
    const started = this.nowMs();
    const calls = new BatchCalls();
    const result = await resolveFont(phrase, installed, { models: this.options.models(), onCall: calls.note }, { ...(habits === undefined ? {} : { habits }), ...bandsOf("font") });
    this.recordOne("font", result, this.fieldsOf(started, site, result.questions), calls.list());
    return result;
  }

  private recordOne(name: string, result: TournamentResult, fields: SettledFields, calls: ReadonlyArray<CallUsage>): void {
    const [tokens] = rowTokens([result.final.provider], calls);
    this.options.log.record([rowOf(name, result.final, fields, tokens ?? null)]);
    this.countCalls(calls);
  }

  private countCalls(calls: ReadonlyArray<CallUsage>): void {
    const requestId = currentRequestId();
    if (requestId !== null && calls.length > 0) this.options.usage?.addDecisions(requestId, calls);
  }

  private nowMs(): number {
    return this.options.clockMs?.() ?? performance.now();
  }

  private fieldsOf(started: number, site: DecisionSite, questions: number): SettledFields {
    return { at: this.options.now().toISOString(), latencyMs: Math.round(this.nowMs() - started), site, questions };
  }
}
