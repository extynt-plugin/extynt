// Counts the model calls one decision batch makes, so that each call's tokens are booked once however many of its answers a row keeps.
import type { CallUsage } from "@extynt/decide";

/** The model calls a batch made, in the order they were answered; the resolver reports each one through `note`. */
export class BatchCalls {
  private readonly made: CallUsage[] = [];

  public readonly note = (call: CallUsage): void => {
    this.made.push(call);
  };

  public list(): ReadonlyArray<CallUsage> {
    return this.made;
  }
}

function sumOf(total: number | null | undefined, tokens: number | null): number | null {
  if (tokens === null) return total ?? null;
  return (total ?? 0) + tokens;
}

function takeTotal(totals: Map<string, number | null>, provider: string | null): number | null {
  if (provider === null || !totals.has(provider)) return null;
  const total = totals.get(provider) ?? null;
  totals.delete(provider);
  return total;
}

/** The input tokens each row carries, aligned with `providers`: a provider's calls book their tokens on its first row and null on the rest, so a call is counted once. */
export function rowTokens(providers: ReadonlyArray<string | null>, calls: ReadonlyArray<CallUsage>): ReadonlyArray<number | null> {
  const totals = new Map<string, number | null>();
  for (const call of calls) totals.set(call.provider, sumOf(totals.get(call.provider), call.inputTokens));
  return providers.map((provider) => takeTotal(totals, provider));
}
