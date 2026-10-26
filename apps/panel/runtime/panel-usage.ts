/**
 * How often the panel calls the model (the guard rail behind "Pause after heavy use"), the token formatter, and the recent
 * request log Debug shows. Memory only.
 */
import type { Decoder } from "@extynt/decode";
import { byId, el } from "./panel-dom.js";
import { t } from "./panel-language.js";
import { pageOpen, pageView } from "./panel-page.js";
import { uiState } from "./ui-state.js";
import { fallback, map, number, object } from "@extynt/decode";

interface RateVerdict { blocked?: boolean; warned?: boolean; message?: string }
interface RequestMetric { at: number; method: string; path: string; durationMs: number; error: boolean }

const MODEL_CALLS_PER_MINUTE = 120;
const WARN_PERCENT = 80;
const MAX_METRICS = 100;

const totals = { minuteStart: Date.now(), modelCalls: 0 };
const metrics: RequestMetric[] = [];

export function formatTokenCount(value: number): string {
  const count = Number(value) || 0;
  if (count < 1000) return String(count);
  if (count < 1000000) return (count / 1000).toFixed(count < 10000 ? 1 : 0) + "k";
  return (count / 1000000).toFixed(1) + "M";
}

function rollWindow(now: number): void {
  if (now - totals.minuteStart > 60000) { totals.modelCalls = 0; totals.minuteStart = now; }
}

function trackModelCalls(modelCalls: number): void {
  rollWindow(Date.now());
  totals.modelCalls += Math.max(1, modelCalls || 1);
}

/** The guard rail against a runaway loop; off when the user turned "Pause after heavy use" off. */
export function checkRateLimits(): RateVerdict {
  if (!uiState().prefs.rateLimit) return {};
  rollWindow(Date.now());
  const percent = (totals.modelCalls / MODEL_CALLS_PER_MINUTE) * 100;
  if (percent >= 100) return { blocked: true, message: t("chrome.usage.blocked") };
  if (percent >= WARN_PERCENT) return { warned: true, message: t("chrome.usage.warned", { percent: Math.round(percent) }) };
  return {};
}

function historyRow(metric: RequestMetric): HTMLElement {
  const row = el("div", metric.error ? "bad" : "");
  const outcome = metric.error ? t("chrome.usage.failed") : t("chrome.usage.ok");
  row.textContent = t("chrome.usage.request", { time: new Date(metric.at).toLocaleTimeString(), method: metric.method, path: metric.path.slice(0, 40), durationMs: metric.durationMs, outcome });
  return row;
}

/** The request log is drawn only while Debug is on screen, or when Debug asks for it. */
export function refreshTelemetryDisplay(force = false): void {
  if (!force && !(pageOpen() && pageView() === "debug")) return;
  const display = byId("telemetry-display");
  if (display) display.textContent = t("chrome.usage.telemetry", { requests: metrics.length, errors: metrics.filter((metric) => metric.error).length, calls: totals.modelCalls, limit: MODEL_CALLS_PER_MINUTE });
  const history = byId("request-history");
  if (!history) return;
  while (history.firstChild) history.removeChild(history.firstChild);
  metrics.slice(-30).reverse().forEach((metric) => history.appendChild(historyRow(metric)));
}

interface RequestOutcome {
  readonly method: string;
  readonly path: string;
  readonly durationMs: number;
  readonly error: boolean;
  readonly polling: boolean;
  readonly modelCalls: number;
}

const modelUseDecoder = object({ usage: fallback(object({}), null), steps: fallback(number(), null) });

/** The model calls an answer reports: its `steps` when it carries token usage, else 0. Never fails. */
export const modelCallsDecoder: Decoder<number> = fallback(map(modelUseDecoder, ({ usage, steps }) => (usage === null ? 0 : steps !== null && steps > 0 ? steps : 1)), 0);

/** Counts a finished request in the request log and the model-call window. */
export function recordRequestMetric(input: RequestOutcome): void {
  if (!input.polling) {
    metrics.push({ at: Date.now(), method: input.method, path: input.path, durationMs: input.durationMs, error: input.error });
    if (metrics.length > MAX_METRICS) metrics.shift();
  }
  if (input.modelCalls > 0) trackModelCalls(input.modelCalls);
  refreshTelemetryDisplay();
}

/** A turn that ended without an answer still made the model calls its last progress poll reported. */
export function recordAbandonedTurnUsage(usage: { totalTokens?: number } | null, steps: number): void {
  if (usage && usage.totalTokens) trackModelCalls(Math.max(1, steps));
}
