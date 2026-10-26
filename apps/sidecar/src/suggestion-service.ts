// Asks the model for prompt suggestions for the current selection, one small call at a time, spaced out and remembered by selection and snapshot.
import type { ProjectSnapshot } from "@extynt/project-graph";
import { effortAtMost, type AgentStepResult, type ToolCallingProvider } from "@extynt/llm";
import { describeSelection } from "./suggestion-description.js";
import { parseSuggestions } from "./suggestion-parse.js";
import { SUGGESTION_SYSTEM, suggestionMessage } from "./suggestion-prompt.js";

const CACHE_ENTRIES = 32;
/** At least this long between two calls to the model, whoever asks. */
export const MIN_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 20_000;

type SuggestionReason = "NO_SELECTION" | "TOO_SOON" | "IN_FLIGHT" | "MODEL_FAILED" | "INVALID_OUTPUT";

/** What one request for suggestions came to: the strings (possibly none), where they came from, and why there are none when there are none. */
export interface SuggestionOutcome {
  readonly suggestions: readonly string[];
  readonly source: "model" | "cache" | "none";
  readonly reason: SuggestionReason | null;
  readonly retryAfterMs?: number;
  readonly usage?: AgentStepResult["usage"];
}

interface SuggestionInput {
  readonly snapshot: ProjectSnapshot;
  readonly selectionFingerprint: string;
  readonly provider: ToolCallingProvider;
  readonly habits: string;
  readonly now: number;
}

interface Flight {
  readonly key: string;
  readonly promise: Promise<SuggestionOutcome>;
}

const none = (reason: SuggestionReason, extra: Pick<SuggestionOutcome, "retryAfterMs" | "usage"> = {}): SuggestionOutcome => ({ suggestions: [], source: "none", reason, ...extra });

const withUsage = (reply: AgentStepResult): Pick<SuggestionOutcome, "usage"> => (reply.usage ? { usage: reply.usage } : {});

const joined = (outcome: SuggestionOutcome): SuggestionOutcome => ({ suggestions: outcome.suggestions, source: outcome.source, reason: outcome.reason });

/** Model-written prompt suggestions for the current selection: one small request at a time, spaced out, remembered by selection and snapshot. `suggest` answers from memory, from one model call, or with none and the reason, and never throws. A second asker for the selection already being answered shares the answer, not its token spend. */
export class SuggestionService {
  private readonly cache = new Map<string, readonly string[]>();
  private lastCallAt: number | undefined;
  private flight: Flight | undefined;
  private calls = 0;

  public forget(): void {
    this.cache.clear();
  }

  private remembered(key: string): readonly string[] | undefined {
    const found = this.cache.get(key);
    if (found) {
      this.cache.delete(key);
      this.cache.set(key, found);
    }
    return found;
  }

  private remember(key: string, suggestions: readonly string[]): void {
    this.cache.set(key, suggestions);
    for (const oldest of this.cache.keys()) {
      if (this.cache.size <= CACHE_ENTRIES) break;
      this.cache.delete(oldest);
    }
  }

  private async step(input: SuggestionInput, description: string): Promise<AgentStepResult | undefined> {
    const effort = effortAtMost(input.provider.config.reasoningEffort, "low");
    this.calls += 1;
    try {
      return await input.provider.step({
        requestId: `suggest-${this.calls}`,
        system: SUGGESTION_SYSTEM,
        messages: [{ role: "user", content: suggestionMessage(description, input.habits) }],
        tools: [],
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
      });
    } catch {
      return undefined;
    }
  }

  private async ask(key: string, input: SuggestionInput, description: string): Promise<SuggestionOutcome> {
    const reply = await this.step(input, description);
    if (!reply) return none("MODEL_FAILED");
    const suggestions = reply.toolCalls.length === 0 ? parseSuggestions(reply.text) : undefined;
    if (!suggestions) return none("INVALID_OUTPUT", withUsage(reply));
    this.remember(key, suggestions);
    return { suggestions, source: "model", reason: null, ...withUsage(reply) };
  }

  private waitMs(now: number): number {
    return this.lastCallAt === undefined ? 0 : Math.min(MIN_INTERVAL_MS, this.lastCallAt + MIN_INTERVAL_MS - now);
  }

  private async start(key: string, input: SuggestionInput, description: string): Promise<SuggestionOutcome> {
    this.lastCallAt = input.now;
    const promise = this.ask(key, input, description);
    this.flight = { key, promise };
    try {
      return await promise;
    } finally {
      this.flight = undefined;
    }
  }

  public async suggest(input: SuggestionInput): Promise<SuggestionOutcome> {
    const key = `${input.selectionFingerprint}|${input.snapshot.fingerprint}`;
    const cached = this.remembered(key);
    if (cached) return { suggestions: cached, source: "cache", reason: null };
    const description = describeSelection(input.snapshot);
    if (!description) return none("NO_SELECTION");
    if (this.flight) return this.flight.key === key ? joined(await this.flight.promise) : none("IN_FLIGHT");
    const wait = this.waitMs(input.now);
    if (wait > 0) return none("TOO_SOON", { retryAfterMs: wait });
    return this.start(key, input, description.text);
  }
}
