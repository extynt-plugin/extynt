/** aeHostCensus: either part alone, the cheap font fingerprint that spares the per-style reads, and the same font records and order as the one-pass census made. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { fieldOf, readJson, recordAt, recordOf, recordsAt, textAt } from "./json-narrow.js";

interface FontSpec {
  readonly family: string;
  readonly style: string;
  readonly ps: string;
}

interface ReadCounter {
  count: number;
}

interface FakeFonts {
  readonly families: FontSpec[][];
  readonly reads: ReadCounter;
}

interface FontRecord {
  readonly family: string;
  readonly style: string;
  readonly postScriptName: string;
}

type CensusRun = (request: JsonObject) => JsonObject;

const FONT_FIELDS = ["family", "style", "postScriptName"] as const;
const DEFAULT_EFFECTS = ["ADBE Blur", "ADBE Glow"];
const FEATURE_FILES = ["host-shared.jsx", "census.jsx", "apply-shared.jsx", "apply-effects.jsx"];

class CountingFont {
  public constructor(private readonly spec: FontSpec, private readonly reads: ReadCounter) {}

  public get familyName(): string {
    this.reads.count += 1;
    return this.spec.family;
  }

  public get styleName(): string {
    this.reads.count += 1;
    return this.spec.style;
  }

  public get postScriptName(): string {
    this.reads.count += 1;
    return this.spec.ps;
  }
}

function installedEffect(matchName: string): JsonObject {
  return { matchName, displayName: matchName, name: matchName, category: "c", version: "1", isInstalled: true };
}

function loadCensus(context: vm.Context, files: readonly string[]): CensusRun {
  for (const file of files) vm.runInContext(readFileSync(`apps/panel/host/${file}`, "utf8"), context, { filename: file });
  return (request) => recordOf(readJson(String(vm.runInContext(`aeHostCensus(${JSON.stringify(JSON.stringify(request))})`, context))));
}

function census(fonts: FakeFonts, effects: readonly string[] = DEFAULT_EFFECTS): CensusRun {
  const groups = fonts.families.map((family) => family.map((spec) => new CountingFont(spec, fonts.reads)));
  const app = { version: "25.0", buildNumber: 1, buildName: "x", fonts: { allFonts: groups }, effects: effects.map(installedEffect) };
  return loadCensus(vm.createContext({ app, $: { os: "Macintosh" } }), ["host-shared.jsx", "census.jsx"]);
}

function featuresRun(menuId: number | undefined, files: readonly string[] = FEATURE_FILES): JsonObject {
  const findMenuCommandId = (name: string): number => {
    if (menuId === undefined) throw new Error("no menu");
    return name === "Outer Glow" ? menuId : 0;
  };
  const app = { version: "26.0", buildNumber: 1, buildName: "x", fonts: { allFonts: [] }, effects: [], findMenuCommandId };
  return recordAt(loadCensus(vm.createContext({ app, $: { os: "Windows" } }), files)(ask({ parts: ["features"] })), "result");
}

function ask(extra: JsonObject = {}): JsonObject {
  return { schemaVersion: "0.1", requestId: "c1", limits: { maxEffects: 10_000, maxFonts: 8192 }, ...extra };
}

function fontsOf(): FakeFonts {
  return {
    reads: { count: 0 },
    families: [
      [{ family: "Zed", style: "Bold", ps: "Zed-Bold" }, { family: "Zed", style: "Regular", ps: "Zed-Regular" }],
      [{ family: "alpha", style: "Italic", ps: "Alpha-Italic" }, { family: "Alpha", style: "Italic", ps: "Alpha-Italic2" }],
      [{ family: "Mid\u0000dle  Name", style: "Reg\tular", ps: "Mid-Reg" }, { family: "x", style: "y", ps: "" }],
    ],
  };
}

function compareFolded(left: string, right: string): number {
  const leftFolded = left.toLowerCase();
  const rightFolded = right.toLowerCase();
  if (leftFolded !== rightFolded) return leftFolded < rightFolded ? -1 : 1;
  if (left !== right) return left < right ? -1 : 1;
  return 0;
}

function referenceCompare(left: FontRecord, right: FontRecord): number {
  for (const field of FONT_FIELDS) {
    const order = compareFolded(left[field], right[field]);
    if (order !== 0) return order;
  }
  return 0;
}

function resultOf(run: CensusRun, extra: JsonObject): JsonObject {
  return recordAt(run(ask(extra)), "result");
}

function fingerprintOf(result: JsonObject): string {
  return textAt(result, "fontFingerprint");
}

test("a census asking for the effects only reads no font, and one asking for the fonts only reads no effect", () => {
  const fonts = fontsOf();
  const run = census(fonts);
  const effects = resultOf(run, { parts: ["effects"] });
  assert.equal(fonts.reads.count, 0, "no font property was touched");
  assert.deepEqual(recordsAt(effects, "installedEffects").map((effect) => textAt(effect, "matchName")), DEFAULT_EFFECTS);
  assert.equal(fieldOf(effects, "part"), "effects");
  assert.equal("installedFonts" in effects, false);
  const only = resultOf(run, { parts: ["fonts"] });
  assert.equal(fieldOf(only, "part"), "fonts");
  assert.equal("installedEffects" in only, false);
  assert.equal(recordsAt(only, "installedFonts").length, 5);
});

test("a census with no parts is the whole census", () => {
  const result = resultOf(census(fontsOf()), {});
  assert.equal(fieldOf(result, "part"), "all");
  assert.equal(recordsAt(result, "installedEffects").length, 2);
  assert.equal(recordsAt(result, "installedFonts").length, 5);
  assert.equal(fieldOf(result, "fontsUnchanged"), false);
  assert.match(fingerprintOf(result), /^ff1\|3\|6\|[0-9a-f]+$/);
});

test("a request with any other part list is refused", () => {
  const run = census(fontsOf());
  const refused: JsonValue[] = [[], ["effects", "fonts", "x"], ["x"], "fonts", null];
  for (const parts of refused) assert.equal(fieldOf(run(ask({ parts })), "error", "code"), "INVALID_REQUEST");
});

test("a fingerprint the caller already holds spares every per-style read and every sort", () => {
  const fonts = fontsOf();
  const run = census(fonts);
  const fingerprint = fingerprintOf(resultOf(run, { parts: ["fonts"] }));
  const readsForFull = fonts.reads.count;
  assert.ok(readsForFull >= 15, "the full read touched every style");
  fonts.reads.count = 0;
  const second = resultOf(run, { parts: ["fonts"], fontFingerprint: fingerprint });
  assert.equal(fieldOf(second, "fontsUnchanged"), true);
  assert.deepEqual(fieldOf(second, "installedFonts"), [], "no records are sent back for a list the caller holds");
  assert.equal(fingerprintOf(second), fingerprint);
  assert.equal(fonts.reads.count, fonts.families.length, `one family-name read per family (${fonts.reads.count}), not one per style (${readsForFull})`);
  const changed = resultOf(run, { parts: ["fonts"], fontFingerprint: "ff1|3|6|0" });
  assert.equal(fieldOf(changed, "fontsUnchanged"), false, "a different fingerprint reads the list again");
  assert.equal(recordsAt(changed, "installedFonts").length, 5);
});

test("adding a font changes the fingerprint", () => {
  const fonts = fontsOf();
  const before = fingerprintOf(resultOf(census(fonts), { parts: ["fonts"] }));
  fonts.families.push([{ family: "New", style: "Regular", ps: "New-Regular" }]);
  assert.notEqual(fingerprintOf(resultOf(census(fonts), { parts: ["fonts"] })), before);
});

test("font records are cleaned and ordered exactly as the one-pass census did", () => {
  const fonts = recordsAt(resultOf(census(fontsOf()), { parts: ["fonts"] }), "installedFonts");
  const records = fonts.map((font): FontRecord => ({ family: textAt(font, "family"), style: textAt(font, "style"), postScriptName: textAt(font, "postScriptName") }));
  assert.deepEqual(records, [...records].sort(referenceCompare), "the keyed sort agrees with the comparator");
  assert.deepEqual(records.map((font) => font.family), ["Alpha", "alpha", "Mid dle Name", "Zed", "Zed"], "control characters and runs of spaces collapse to one space; a family that folds equal sorts by its raw text");
  assert.deepEqual(records.find((font) => font.postScriptName === "Mid-Reg"), { family: "Mid dle Name", style: "Reg ular", postScriptName: "Mid-Reg" });
});

test("the features part answers whether the Layer Style menu commands are live, and reads neither effects nor fonts", () => {
  const live = featuresRun(9002);
  assert.equal(fieldOf(live, "part"), "features");
  assert.equal(fieldOf(live, "layerStyleCommandsLive"), true);
  assert.equal("installedEffects" in live || "installedFonts" in live, false);
  assert.equal(fieldOf(featuresRun(0), "layerStyleCommandsLive"), false, "an unregistered command id means the menu is not built yet");
  assert.equal(fieldOf(featuresRun(undefined), "layerStyleCommandsLive"), false, "a lookup that throws is not live");
  assert.equal(fieldOf(featuresRun(9002, ["host-shared.jsx", "census.jsx"]), "layerStyleCommandsLive"), null, "without the apply scripts the answer is unknown, never a guess");
});

test("the default census does not carry the features answer", () => {
  assert.equal("layerStyleCommandsLive" in resultOf(census(fontsOf()), {}), false);
});
