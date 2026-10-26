/**
 * "Time left" for a long job: remaining items x the whole-run working rate (lightly blended with a recent window), as a narrow range.
 *
 * Pure, so every case is a unit test. It reads only the job's own facts (when it started, when each checklist item was
 * verified, the intervals the job spent waiting for the user) and the clock, so a reloaded panel gives the same answer.
 * Waiting intervals are subtracted from every span, so a job that sat on an Apply prompt for an hour is not "slow".
 */
import type { UiChecklistItem, UiWait } from "./ui-jobs.js";
import { t } from "./panel-language.js";

const RATE_WINDOW_ITEMS = 8;
const MIN_ITEMS = 5;
const MIN_SHARE = 0.1;
const SLOWING_RATIO = 1.5;
const RECENT_WEIGHT = 0.25;
const LOW_FACTOR = 0.8, HIGH_FACTOR = 1.3, SLOWING_HEADROOM = 1.25;
const MAX_HIGH_OVER_LOW = 2.5, MAX_HIGH_OVER_LOW_STEADY = 2;

export interface EtaFacts {
  startedAt: string;
  waits: ReadonlyArray<UiWait>;
  items: ReadonlyArray<UiChecklistItem>;
  nowMs: number;
}

/** hidden: say nothing. estimating: too early. offline: the clock is stopped by a lost link. range: lowMs..highMs. */
export type TimeLeft =
  | { kind: "hidden" }
  | { kind: "estimating"; text: string }
  | { kind: "offline"; text: string }
  | { kind: "range"; lowMs: number; highMs: number; slowing: boolean; text: string };

const MINUTE = 60_000;
const STALL_FLOOR_MS = 60_000;

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return isFinite(ms) ? ms : null;
}

/** Milliseconds of [from, to] that fall inside a waiting interval (an open interval runs to `nowMs`). */
export function waitedBetween(waits: ReadonlyArray<UiWait>, from: number, to: number, nowMs: number): number {
  let total = 0;
  for (const wait of waits) {
    const start = timeOf(wait.from);
    if (start === null) continue;
    const end = wait.to === null ? nowMs : timeOf(wait.to) ?? nowMs;
    const overlap = Math.min(to, end) - Math.max(from, start);
    if (overlap > 0) total += overlap;
  }
  return total;
}

/** Working time between two instants: the span minus any waiting inside it, never below zero. */
export function workedBetween(waits: ReadonlyArray<UiWait>, from: number, to: number, nowMs: number): number {
  return Math.max(0, to - from - waitedBetween(waits, from, to, nowMs));
}

interface Event { at: number; items: number }

function eventsOf(items: ReadonlyArray<UiChecklistItem>): Event[] {
  const stamps = items.filter((item) => item.status === "verified").map((item) => timeOf(item.verifiedAt)).filter((at): at is number => at !== null).sort((a, b) => a - b);
  const events: Event[] = [];
  for (const at of stamps) {
    const last = events[events.length - 1];
    if (last && last.at === at) last.items += 1; else events.push({ at: at, items: 1 });
  }
  return events;
}

/** "≈ 45–70 min left": 5-minute steps up to an hour and a half, then hours with one decimal; one number when the range collapses. */
export function rangeWords(lowMs: number, highMs: number): string {
  const lowMin = lowMs / MINUTE, highMin = Math.max(lowMin, highMs / MINUTE);
  if (highMin < 2) return t("status.eta.minutesLeft", { count: 1 });
  if (highMin <= 90) return minuteWords(Math.max(5, Math.floor(lowMin / 5) * 5), Math.max(5, Math.ceil(highMin / 5) * 5));
  return hourWords(lowMin, highMin);
}

function minuteWords(low: number, high: number): string {
  const top = Math.max(low, high);
  return low === top ? t("status.eta.minutesLeft", { count: top }) : t("status.eta.minutesRange", { low: low, high: top });
}

function hourWords(lowMin: number, highMin: number): string {
  const hours = (minutes: number): number => Math.round((minutes / 60) * 10) / 10;
  const low = hours(lowMin), high = hours(highMin);
  return low === high ? t("status.eta.hoursLeft", { count: high }) : t("status.eta.hoursRange", { low: low, high: high });
}

/** Whether enough items are verified to say anything but "estimating…". */
export function enoughItems(verified: number, total: number): boolean {
  return verified >= 1 && (verified >= MIN_ITEMS || (total > 0 && verified >= total * MIN_SHARE));
}

interface RateInput { facts: EtaFacts; events: ReturnType<typeof eventsOf>; startedMs: number; lastAt: number; verified: number }

function ratesOf(input: RateInput): { wholeRate: number; recentRate: number; windowItems: number; rate: number } {
  const { facts, events, startedMs, lastAt, verified } = input;
  const wholeRate = workedBetween(facts.waits, startedMs, lastAt, facts.nowMs) / verified;
  let windowItems = 0, firstInWindow = events.length;
  for (let index = events.length - 1; index >= 0 && windowItems < RATE_WINDOW_ITEMS; index -= 1) {
    windowItems += events[index]?.items ?? 0;
    firstInWindow = index;
  }
  const windowFrom = firstInWindow === 0 ? startedMs : (events[firstInWindow - 1]?.at ?? startedMs);
  const recentRate = workedBetween(facts.waits, windowFrom, lastAt, facts.nowMs) / windowItems;
  return { wholeRate, recentRate, windowItems, rate: wholeRate * (1 - RECENT_WEIGHT) + recentRate * RECENT_WEIGHT };
}

interface RangeInput {
  facts: EtaFacts; startedMs: number; lastAt: number; remaining: number; eventCount: number;
  rates: { wholeRate: number; recentRate: number; windowItems: number; rate: number };
}

function rangeOf(input: RangeInput): TimeLeft {
  const { facts, startedMs, lastAt, remaining } = input;
  const { wholeRate, recentRate, windowItems, rate } = input.rates;
  const sinceLast = workedBetween(facts.waits, lastAt, facts.nowMs, facts.nowMs);
  const eventGap = workedBetween(facts.waits, startedMs, lastAt, facts.nowMs) / input.eventCount;
  const expected = Math.max(rate, eventGap, STALL_FLOOR_MS);
  const excess = Math.max(0, sinceLast - expected);
  const slowing = (windowItems >= 3 && recentRate > wholeRate * SLOWING_RATIO) || sinceLast > expected * SLOWING_RATIO;
  const central = remaining * rate + excess;
  const low = central * LOW_FACTOR;
  const high = Math.min(central * HIGH_FACTOR * (slowing ? SLOWING_HEADROOM : 1), low * (slowing ? MAX_HIGH_OVER_LOW : MAX_HIGH_OVER_LOW_STEADY));
  return { kind: "range", lowMs: low, highMs: high, slowing: slowing, text: rangeWords(low, high) + (slowing ? " · " + t("status.eta.slowing") : "") };
}

function tooEarly(eventCount: number, verified: number, total: number): boolean {
  return eventCount === 0 || !enoughItems(verified, total);
}

function finished(total: number, verified: number): boolean {
  return total === 0 || verified >= total;
}

/**
 * The time left, or why there is none to show. `paused` is true while the clock is stopped for the user (a held Apply,
 * a choice, a pause): nothing is shown then. `linkDown` is true when After Effects or the helper is away: the words say so.
 */
export function timeLeft(facts: EtaFacts, state: { paused: boolean; linkDown: boolean }): TimeLeft {
  const total = facts.items.length;
  const verified = facts.items.filter((item) => item.status === "verified").length;
  if (finished(total, verified) || state.paused) return { kind: "hidden" };
  if (state.linkDown) return { kind: "offline", text: t("status.eta.offline") };
  const startedMs = timeOf(facts.startedAt);
  const events = eventsOf(facts.items);
  if (startedMs === null || tooEarly(events.length, verified, total)) return { kind: "estimating", text: t("status.eta.estimating") };
  const lastAt = events.at(-1)?.at ?? 0;
  const { wholeRate, recentRate, windowItems, rate } = ratesOf({ facts, events, startedMs, lastAt, verified });
  return rangeOf({ facts, startedMs, lastAt, remaining: total - verified, eventCount: events.length, rates: { wholeRate, recentRate, windowItems, rate } });
}
