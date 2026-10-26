/** Per-step token accounting: `AgentProgress.usage` is the turn's running total, so the per-step figure is the difference between two readings. */
export type StepUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number };

export function usageIsMonotonic(previous: StepUsage | undefined, usage: StepUsage): boolean {
  return previous !== undefined
    && usage.inputTokens >= previous.inputTokens
    && usage.outputTokens >= previous.outputTokens
    && usage.cachedInputTokens >= previous.cachedInputTokens;
}

export function usageDelta(previous: StepUsage | undefined, usage: StepUsage): StepUsage {
  return {
    inputTokens: usage.inputTokens - (previous?.inputTokens ?? 0),
    outputTokens: usage.outputTokens - (previous?.outputTokens ?? 0),
    cachedInputTokens: usage.cachedInputTokens - (previous?.cachedInputTokens ?? 0),
  };
}

export function usageHasSpend(usage: StepUsage): boolean {
  return usage.inputTokens !== 0 || usage.outputTokens !== 0 || usage.cachedInputTokens !== 0;
}
