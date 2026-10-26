/**
 * Prompt suggestions for the selection: when to ask the sidecar, and what to do with the answer.
 *
 * The words are the model's: the sidecar asks it, from the selected layers, and sends back two or three short prompts.
 * Nothing here knows, stores or falls back to any prompt text. This module is the timing and the rules (settle, ask once,
 * drop on any sign the user has moved on) as a small state machine with every effect handed in, so each case can be
 * tested without a DOM or a clock. A chip is only ever offered; putting it in the composer is the user's click, and
 * sending is still the user's Send.
 */
import type { Infer } from "@extynt/decode";
import { fallback, jsonValue, type JsonValue, literal, map, number, object, skippingInvalid } from "@extynt/decode";

/** How long the selection must stay the same before anything is asked. */
export const SETTLE_MS = 1200;
/** A hidden panel asks nothing; the wait is checked again this often. */
export const HIDDEN_WAIT_MS = 2000;
/** A sidecar that says "too soon" is believed once, and only for a short wait. */
export const RETRY_AT_MOST_MS = 6000;
const RETRY_MARGIN_MS = 100;
const SHORTEST = 3;
const LONGEST = 48;
const MOST = 3;
const FEWEST_SHOWN = 2;

function usable(text: string): boolean {
  return text.length >= SHORTEST && text.length <= LONGEST && !/[\r\n]/.test(text);
}

function promptsIn(entries: ReadonlyArray<JsonValue>): string[] {
  const kept: string[] = [];
  for (const entry of entries) {
    const text = typeof entry === "string" ? entry.trim() : "";
    if (usable(text) && !kept.includes(text) && kept.length < MOST) kept.push(text);
  }
  return kept.length >= FEWEST_SHOWN ? kept : [];
}

function waitOf(wait: number | null): number | null {
  return wait !== null && isFinite(wait) && wait > 0 && wait <= RETRY_AT_MOST_MS ? Math.ceil(wait) : null;
}

const answerShape = object({ ok: fallback(literal(true), false), suggestions: fallback(skippingInvalid(jsonValue), []), retryAfterMs: fallback(number(), null) });

/** The sidecar's answer as a short list of one-line prompts (two or three, else none) and a short wait it may ask for. */
export const answerDecoder = map(answerShape, (body) => ({
  suggestions: body.ok ? promptsIn(body.suggestions) : [],
  retryAfterMs: waitOf(body.retryAfterMs),
}));

/** What one ask returned. */
export type Answer = Infer<typeof answerDecoder>;

/** What the suggester needs from the panel, all of it handed in. */
export interface SuggestDeps {
  readonly enabled: () => boolean;
  readonly visible: () => boolean;
  readonly busy: () => boolean;
  readonly composerEmpty: () => boolean;
  readonly guardOk: () => boolean;
  readonly ask: (fingerprint: string, done: (answer: Answer | null) => void) => void;
  readonly show: (suggestions: ReadonlyArray<string>) => void;
  readonly hide: () => void;
  readonly later: (run: () => void, ms: number) => ReturnType<typeof setTimeout> | null;
  readonly cancel: (handle: ReturnType<typeof setTimeout>) => void;
}

interface Suggester {
  readonly selection: (fingerprint: string, selected: number) => void;
  readonly turn: (running: boolean) => void;
  readonly typed: () => void;
  readonly setting: () => void;
}

interface Memory {
  current: string | null;
  count: number;
  generation: number;
  asked: boolean;
  retried: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

function cancelTimer(deps: SuggestDeps, memory: Memory): void {
  if (memory.timer === null) return;
  deps.cancel(memory.timer);
  memory.timer = null;
}

function stop(deps: SuggestDeps, memory: Memory): void {
  memory.generation += 1;
  cancelTimer(deps, memory);
  deps.hide();
}

function arm(deps: SuggestDeps, memory: Memory, ms: number): void {
  cancelTimer(deps, memory);
  const mine = memory.generation;
  memory.timer = deps.later(() => {
    memory.timer = null;
    if (mine === memory.generation) attempt(deps, memory);
  }, ms);
}

function wantsRetry(memory: Memory, answer: Answer): answer is Answer & { readonly retryAfterMs: number } {
  return answer.retryAfterMs !== null && !memory.retried && answer.suggestions.length === 0;
}

function arrived(deps: SuggestDeps, memory: Memory, mine: number, answer: Answer | null): void {
  if (mine !== memory.generation || answer === null) return;
  if (wantsRetry(memory, answer)) {
    memory.retried = true;
    memory.asked = false;
    arm(deps, memory, answer.retryAfterMs + RETRY_MARGIN_MS);
    return;
  }
  if (answer.suggestions.length > 0 && deps.visible() && !deps.busy() && deps.composerEmpty()) deps.show(answer.suggestions);
}

function mayAsk(deps: SuggestDeps, memory: Memory): boolean {
  return !memory.asked && memory.current !== null && memory.count > 0 && deps.enabled();
}

function attempt(deps: SuggestDeps, memory: Memory): void {
  if (!mayAsk(deps, memory) || memory.current === null) return;
  if (!deps.visible()) {
    arm(deps, memory, HIDDEN_WAIT_MS);
    return;
  }
  if (deps.busy() || !deps.composerEmpty() || !deps.guardOk()) return;
  memory.asked = true;
  const mine = memory.generation;
  deps.ask(memory.current, (answer) => arrived(deps, memory, mine, answer));
}

function onSelection(deps: SuggestDeps, memory: Memory, fingerprint: string, selected: number): void {
  if (!fingerprint) return;
  if (fingerprint === memory.current) {
    memory.count = selected;
    return;
  }
  stop(deps, memory);
  memory.current = fingerprint;
  memory.count = selected;
  memory.asked = false;
  memory.retried = false;
  if (selected > 0) arm(deps, memory, SETTLE_MS);
}

function onTurn(deps: SuggestDeps, memory: Memory, running: boolean): void {
  if (running) {
    stop(deps, memory);
    return;
  }
  if (!memory.asked && memory.current !== null && memory.count > 0) arm(deps, memory, SETTLE_MS);
}

function onSetting(deps: SuggestDeps, memory: Memory): void {
  if (!deps.enabled()) {
    stop(deps, memory);
    memory.asked = true;
    return;
  }
  if (memory.current === null || memory.count === 0) return;
  memory.asked = false;
  arm(deps, memory, SETTLE_MS);
}

/**
 * One selection, one ask: a changed selection that stays put for a moment, in a visible panel with no turn running, an
 * empty composer and the guard quiet, is asked about once. The answer is shown only if all of that still holds when it
 * arrives. A new selection, a turn starting, or typing hides the chips and discards any answer still on its way.
 */
export function createSuggester(deps: SuggestDeps): Suggester {
  const memory: Memory = { current: null, count: 0, generation: 0, asked: false, retried: false, timer: null };
  return {
    selection: (fingerprint, selected) => onSelection(deps, memory, fingerprint, selected),
    turn: (running) => onTurn(deps, memory, running),
    typed: () => {
      if (deps.composerEmpty()) return;
      stop(deps, memory);
      memory.asked = true;
    },
    setting: () => onSetting(deps, memory),
  };
}

