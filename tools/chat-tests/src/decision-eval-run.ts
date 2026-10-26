// Runs suites against the decision models with a small pool of concurrent requests; every case is asked raw so routing can be simulated afterwards.
import type { CaseRun } from "./decision-eval-routing.js";
import type { AskOptions, ResolveCase, ResolveRun, ResolveSuite, SpecSuite } from "./decision-eval-types.js";

const POOL_SIZE = 4;

/** One end-to-end case through the word search alone and, when models are configured, through them. */
export interface ResolveOutcome {
  readonly case: ResolveCase;
  readonly offline: ResolveRun;
  readonly model: ResolveRun | null;
}

async function mapPool<T, R>(items: ReadonlyArray<T>, size: number, work: (item: T) => Promise<R>): Promise<ReadonlyArray<R>> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

/** Puts every case of a suite to the models raw, and for choice cases once more with the labels reversed; with no models nothing is asked. */
export async function runSpecSuite(suite: SpecSuite, options: AskOptions): Promise<ReadonlyArray<CaseRun>> {
  if (options.models.length === 0) return suite.cases.map((spec) => ({ spec, raw: null, reversed: null }));
  return mapPool(suite.cases, POOL_SIZE, async (spec): Promise<CaseRun> => {
    const [raw, reversed] = await Promise.all([spec.ask(options, false), spec.reversible ? spec.ask(options, true) : Promise.resolve(null)]);
    return { spec, raw, reversed };
  });
}

/** Puts every case of a tournament suite to the word search alone and to the models. */
export async function runResolveSuite(suite: ResolveSuite, options: AskOptions): Promise<ReadonlyArray<ResolveOutcome>> {
  const offlineOptions: AskOptions = { ...options, models: [] };
  return mapPool(suite.cases, POOL_SIZE, async (resolveCase): Promise<ResolveOutcome> => ({
    case: resolveCase,
    offline: await resolveCase.resolve(offlineOptions),
    model: options.models.length === 0 ? null : await resolveCase.resolve(options),
  }));
}
