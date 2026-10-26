// Support for the live decision tests: the Jev models built from the environment with a stopwatch on every request, the suite tally that prints accuracy, requests and median latency, and the fixtures that stand in for a host (After Effects effects and system fonts only).
import assert from "node:assert/strict";
import { DEFAULT_DECISION_TIMEOUT_MS, decisionModelsFromEnvironment, liveSkipReason, type DecisionModel } from "@extynt/decide";
import { makeFontInventory, makeHostProfile, makeInventory, type ControlSchema, type HostCapabilityProfile, type InventoryItem } from "@extynt/capability-catalogue";
import type { DecisionLog, DecisionLogRow } from "../src/decision-log.js";
import { DecisionService } from "../src/decision-service.js";

const LIVE_KEY = process.env.TYPESAFE_API_KEY || process.env.EXTYNT_LIVE_TYPESAFE_API_KEY || "";

/** The reason every live test gives for skipping, or false when a TypeSafe key is available and accepted (TYPESAFE_API_KEY, or the key the test runner loaded from the developer's jev.env); a rejected key or a network outage skips with its own reason. */
export const SKIP: string | false = await liveSkipReason(LIVE_KEY);

/** Decision models whose every request is timed. */
export interface Metered {
  readonly models: ReadonlyArray<DecisionModel>;
  readonly latenciesMs: number[];
}

/** The decision models of an environment, each request timed into `latenciesMs`. */
export function meteredModels(environment: Readonly<Record<string, string | undefined>>): Metered {
  const latenciesMs: number[] = [];
  const models = decisionModelsFromEnvironment(environment).map((model): DecisionModel => ({
    ...model,
    decide: async (state, questions, signal) => {
      const started = performance.now();
      const outcome = await model.decide(state, questions, signal);
      latenciesMs.push(Math.round(performance.now() - started));
      return outcome;
    },
  }));
  return { models, latenciesMs };
}

/** A decision service over the real Jev, with its timed requests and its log rows. */
export interface LiveService {
  readonly service: DecisionService;
  readonly meter: Metered;
  readonly rows: DecisionLogRow[];
}

/** A service over the models of the environment, defaulting to the real key. */
export function liveService(environment: Readonly<Record<string, string | undefined>> = { TYPESAFE_API_KEY: LIVE_KEY }): LiveService {
  const meter = meteredModels(environment);
  const rows: DecisionLogRow[] = [];
  const log: DecisionLog = { record: (batch) => { rows.push(...batch); } };
  return { service: new DecisionService({ models: () => meter.models, log, now: () => new Date(), clockMs: () => performance.now() }), meter, rows };
}

function median(values: ReadonlyArray<number>): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * The tally of one suite.  A model answer that differs from the expectation is a miss, printed by `finish`, not a failure of its own: the suite
 * passes when its accuracy reaches `minimumAccuracy`, a fraction set just under the lowest score the suite reliably reaches.  A low-confidence answer
 * counts as declined (it falls back to the offline tier by design).  The latency check and the "asked nothing" check fail at once.
 * A request is held to the timeout the decision package itself enforces, so the check does not move with machine load.
 */
export class Suite {
  private hits = 0;
  private total = 0;
  private declined = 0;
  private seen = 0;
  private readonly misses: string[] = [];

  public constructor(private readonly name: string, private readonly meter: Metered, private readonly minimumAccuracy: number, private readonly rows: ReadonlyArray<DecisionLogRow> = []) {}

  public check<Value>(actual: Value, expected: Value, label: string): void {
    this.checkWhere(JSON.stringify(actual) === JSON.stringify(expected), `${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }

  public checkWhere(correct: boolean, message: string): void {
    this.total += 1;
    const fresh = this.rows.slice(this.seen);
    this.seen = this.rows.length;
    if (correct) {
      this.hits += 1;
      return;
    }
    if (fresh.some((row) => row.tier === "deterministic" && row.fallback === "low-confidence")) this.declined += 1;
    this.misses.push(message);
  }

  public requests(): number {
    return this.meter.latenciesMs.length;
  }

  public finish(): void {
    const { latenciesMs } = this.meter;
    const slowest = Math.max(0, ...latenciesMs);
    console.log(`[decision-live] ${this.name}: accuracy ${this.hits}/${this.total}, declined ${this.declined}, requests ${latenciesMs.length}, median ${median(latenciesMs)} ms, max ${slowest} ms`);
    for (const miss of this.misses) console.log(`[decision-live] ${this.name}: missed ${miss}`);
    assert.ok(latenciesMs.length > 0, "the suite asked the model nothing");
    assert.ok(slowest < DEFAULT_DECISION_TIMEOUT_MS, `a request took ${slowest} ms`);
    assert.ok(this.hits >= this.minimumAccuracy * this.total, `${this.name}: accuracy ${this.hits}/${this.total} is below the minimum ${this.minimumAccuracy}`);
  }
}

const CONTROL_ROWS: Readonly<Record<string, ReadonlyArray<readonly [string, string, string]>>> = {
  "ADBE Gaussian Blur 2": [["ADBE Gaussian Blur 2-0001", "Blurriness", "OneD"], ["ADBE Gaussian Blur 2-0002", "Blur Dimensions", "OneD"], ["ADBE Gaussian Blur 2-0003", "Repeat Edge Pixels", "OneD"]],
  "ADBE Box Blur2": [["ADBE Box Blur2-0001", "Blur Radius", "OneD"], ["ADBE Box Blur2-0002", "Iterations", "OneD"], ["ADBE Box Blur2-0003", "Blur Dimensions", "OneD"]],
  "ADBE Glo2": [["ADBE Glo2-0001", "Glow Based On", "OneD"], ["ADBE Glo2-0002", "Glow Threshold", "OneD"], ["ADBE Glo2-0003", "Glow Radius", "OneD"], ["ADBE Glo2-0004", "Glow Intensity", "OneD"], ["ADBE Glo2-0005", "Glow Colors", "OneD"]],
  "ADBE Drop Shadow": [["ADBE Drop Shadow-0001", "Shadow Color", "COLOR"], ["ADBE Drop Shadow-0002", "Opacity", "OneD"], ["ADBE Drop Shadow-0003", "Direction", "OneD"], ["ADBE Drop Shadow-0004", "Distance", "OneD"], ["ADBE Drop Shadow-0005", "Softness", "OneD"]],
};

const BLUR = "Blur & Sharpen", STYLIZE = "Stylize", GENERATE = "Generate", COLOR = "Color Correction", DISTORT = "Distort", KEYING = "Keying";

const EFFECT_ROWS: ReadonlyArray<readonly [string, string, string]> = [
  ["ADBE Gaussian Blur 2", "Gaussian Blur", BLUR], ["ADBE Box Blur2", "Fast Box Blur", BLUR], ["ADBE Camera Lens Blur", "Camera Lens Blur", BLUR],
  ["ADBE Motion Blur", "Directional Blur", BLUR], ["ADBE Radial Blur", "Radial Blur", BLUR], ["ADBE Sharpen", "Sharpen", BLUR], ["ADBE Unsharp Mask2", "Unsharp Mask", BLUR],
  ["CC Vector Blur", "CC Vector Blur", BLUR], ["CC Radial Fast Blur", "CC Radial Fast Blur", BLUR],
  ["ADBE Glo2", "Glow", STYLIZE], ["ADBE Mosaic", "Mosaic", STYLIZE], ["ADBE Find Edges", "Find Edges", STYLIZE], ["ADBE Emboss", "Emboss", STYLIZE], ["CC Glass", "CC Glass", STYLIZE],
  ["ADBE Drop Shadow", "Drop Shadow", "Perspective"], ["ADBE Bevel Alpha", "Bevel Alpha", "Perspective"],
  ["ADBE Fill", "Fill", GENERATE], ["ADBE Ramp", "Gradient Ramp", GENERATE], ["ADBE 4ColorGradient", "4-Color Gradient", GENERATE], ["ADBE Fractal Noise", "Fractal Noise", "Noise & Grain"],
  ["ADBE Grid", "Grid", GENERATE], ["ADBE Cell Pattern", "Cell Pattern", GENERATE], ["CC Light Sweep", "CC Light Sweep", GENERATE],
  ["ADBE Tint", "Tint", COLOR], ["ADBE CurvesCustom", "Curves", COLOR], ["ADBE Easy Levels2", "Levels", COLOR], ["ADBE HUE SATURATION", "Hue/Saturation", COLOR],
  ["ADBE Brightness & Contrast 2", "Brightness & Contrast", COLOR], ["ADBE Tritone", "Tritone", COLOR], ["ADBE Exposure2", "Exposure", COLOR], ["ADBE Color Balance 2", "Color Balance", COLOR],
  ["ADBE Turbulent Displace", "Turbulent Displace", DISTORT], ["ADBE Wave Warp", "Wave Warp", DISTORT], ["ADBE Bulge", "Bulge", DISTORT], ["ADBE Spherize", "Spherize", DISTORT], ["ADBE Mesh Warp", "Mesh Warp", DISTORT],
  ["Keylight 1.2", "Keylight (1.2)", KEYING], ["ADBE Linear Color Key2", "Linear Color Key", KEYING], ["ADBE Simple Choker", "Simple Choker", "Matte"],
  ["ADBE Add Grain", "Add Grain", "Noise & Grain"], ["ADBE Echo", "Echo", "Time"], ["ADBE Posterize Time", "Posterize Time", "Time"], ["ADBE Linear Wipe", "Linear Wipe", "Transition"],
  ["ADBE Invert", "Invert", "Channel"], ["CC Particle World", "CC Particle World", "Simulation"],
];

function controlsOf(matchName: string): ControlSchema[] {
  return (CONTROL_ROWS[matchName] ?? []).map(([controlMatchName, displayName, valueType]) => ({ path: displayName, matchName: controlMatchName, displayName, valueType }));
}

function inventoryItem([matchName, displayName, category]: readonly [string, string, string]): InventoryItem {
  return { matchName, displayName, category, available: true, evidence: [] };
}

const HOST = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" };

/** How many synthetic effects pad a profile past the flat limit. */
export const SYNTHETIC_COUNT = 260;

function syntheticRows(count: number): ReadonlyArray<readonly [string, string, string]> {
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(4, "0");
    return [`SYNTH Effect ${number}`, `Synthetic Effect ${number}`, `Synthetic ${index % 6}`] as const;
  });
}

/** A host profile of After Effects' own effects (with controls for a few), padded with synthetic ones, and optionally with system fonts. */
export function hostProfile(options: { readonly padding: number; readonly fonts: ReadonlyArray<readonly [string, string, string]> }): HostCapabilityProfile {
  const inventory = makeInventory(HOST, [...EFFECT_ROWS, ...syntheticRows(options.padding)].map(inventoryItem));
  const profile = makeHostProfile(inventory, undefined, undefined, makeFontInventory(options.fonts.map(([family, style, postScriptName]) => ({ family, style, postScriptName }))));
  return { ...profile, entries: profile.entries.map((entry) => (entry.matchName === undefined ? entry : { ...entry, controls: controlsOf(entry.matchName) })) };
}

/** System fonts of macOS and Windows, as family, style and PostScript name. */
export const SYSTEM_FONTS: ReadonlyArray<readonly [string, string, string]> = [
  ["Arial", "Regular", "ArialMT"], ["Arial", "Bold", "Arial-BoldMT"], ["Helvetica", "Regular", "Helvetica"], ["Helvetica Neue", "Regular", "HelveticaNeue"], ["Helvetica Neue", "Bold", "HelveticaNeue-Bold"],
  ["Times New Roman", "Regular", "TimesNewRomanPSMT"], ["Georgia", "Regular", "Georgia"], ["Courier New", "Regular", "CourierNewPSMT"], ["Verdana", "Regular", "Verdana"],
  ["Trebuchet MS", "Regular", "TrebuchetMS"], ["Impact", "Regular", "Impact"], ["Futura", "Medium", "Futura-Medium"], ["Gill Sans", "Regular", "GillSans"], ["Menlo", "Regular", "Menlo-Regular"],
  ["Monaco", "Regular", "Monaco"], ["Palatino", "Regular", "Palatino-Roman"], ["Comic Sans MS", "Regular", "ComicSansMS"], ["Avenir", "Book", "Avenir-Book"], ["Baskerville", "Regular", "Baskerville"],
  ["Optima", "Regular", "Optima-Regular"], ["Didot", "Regular", "Didot"], ["Tahoma", "Regular", "Tahoma"], ["Calibri", "Regular", "Calibri"], ["Cambria", "Regular", "Cambria"],
  ["Segoe UI", "Regular", "SegoeUI"], ["Consolas", "Regular", "Consolas"], ["Lucida Grande", "Regular", "LucidaGrande"], ["Copperplate", "Regular", "Copperplate"], ["Papyrus", "Regular", "Papyrus"],
];

const SHARPENING: ReadonlySet<string> = new Set(["ADBE Sharpen", "ADBE Unsharp Mask2"]);

/** The match names of the blur effects among the fixtures. */
export const BLUR_MATCH_NAMES: ReadonlySet<string> = new Set(EFFECT_ROWS.filter(([matchName, , category]) => category === BLUR && !SHARPENING.has(matchName)).map(([matchName]) => matchName));
