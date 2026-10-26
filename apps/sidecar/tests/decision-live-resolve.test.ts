// Live check of the build-kit pre-resolution against the real Jev: effects (flat and tournament), controls, fonts and the habit tie-break, each over a host profile of After Effects' own effects and system fonts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach, describe } from "node:test";
import { clearResolutions, resolveRequestTerms } from "../src/decision-resolve.js";
import { PreferenceTally } from "../src/preference-tally.js";
import { BLUR_MATCH_NAMES, SKIP, SYNTHETIC_COUNT, Suite, hostProfile, liveService, SYSTEM_FONTS } from "./decision-live-support.js";

beforeEach(() => clearResolutions());

const NO_FONTS = hostProfile({ padding: 0, fonts: [] });
const sourcesOf = (profile = NO_FONTS) => ({ profile, snapshot: undefined, preferences: undefined });

const EFFECT_CASES: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ["soften the background", BLUR_MATCH_NAMES],
  ["make it glow", new Set(["ADBE Glo2"])],
  ["add a soft shadow behind the logo", new Set(["ADBE Drop Shadow"])],
  ["fill the layer with a flat colour", new Set(["ADBE Fill"])],
  ["tint the footage so it looks warm", new Set(["ADBE Tint"])],
  ["adjust the contrast with a curve", new Set(["ADBE CurvesCustom"])],
  ["set the black point and white point of the image", new Set(["ADBE Easy Levels2"])],
  ["desaturate the footage", new Set(["ADBE HUE SATURATION"])],
  ["make the title wobble like heat haze", new Set(["ADBE Turbulent Displace"])],
  ["add a cloudy noise texture", new Set(["ADBE Fractal Noise"])],
  ["key out the green screen", new Set(["Keylight 1.2"])],
  ["give it a fast sideways motion streak", new Set(["ADBE Motion Blur"])],
  ["Füge einen Weichzeichner hinzu", BLUR_MATCH_NAMES],
  ["añade una sombra al texto", new Set(["ADBE Drop Shadow"])],
];

describe("live effect pre-resolution", { skip: SKIP }, () => {
  const live = liveService();
  const suite = new Suite("effects (flat)", live.meter, 0.93);
  for (const [request, accepted] of EFFECT_CASES) {
    test(`"${request}" resolves to the right effect`, async () => {
      const terms = await resolveRequestTerms(live.service, request, sourcesOf());
      const effect = terms.find((term) => term.kind === "effect");
      suite.checkWhere(effect !== undefined && accepted.has(effect.key), `${request} -> ${effect?.key}`);
    });
  }
  test("a rejected effect resolves to nothing", async () => {
    const terms = await resolveRequestTerms(live.service, "no glow, please", sourcesOf());
    suite.checkWhere(!terms.some((term) => term.key === "ADBE Glo2"), `no glow -> ${terms.map((term) => term.key).join(",")}`);
  });
  test("a two-part request resolves both parts", async () => {
    const keys = (await resolveRequestTerms(live.service, "soften the background and make the title glow", sourcesOf())).filter((term) => term.kind === "effect").map((term) => term.key);
    suite.checkWhere(keys.some((key) => BLUR_MATCH_NAMES.has(key)) && keys.includes("ADBE Glo2"), `two parts -> ${keys.join(",")}`);
  });
  test("one request resolved each clause in a batch", () => { suite.finish(); });
});

describe("live control pre-resolution", { skip: SKIP }, () => {
  const live = liveService();
  const suite = new Suite("controls", live.meter, 0.66);
  const CASES: ReadonlyArray<readonly [string, string]> = [
    ["make the glow radius bigger", "ADBE Glo2-0003"],
    ["push the shadow further away", "ADBE Drop Shadow-0004"],
    ["make the glow brighter", "ADBE Glo2-0004"],
  ];
  for (const [request, control] of CASES) {
    test(`"${request}" resolves to its control`, async () => {
      const terms = await resolveRequestTerms(live.service, request, sourcesOf());
      suite.checkWhere(terms.some((term) => term.kind === "control" && term.key === control), `${request} -> ${terms.map((term) => term.key).join(",")}`);
    });
  }
  test("the controls suite is timed", () => { suite.finish(); });
});

describe("live tournament pre-resolution", { skip: SKIP }, () => {
  const live = liveService();
  const suite = new Suite("effects (tournament)", live.meter, 0.74);
  const padded = hostProfile({ padding: SYNTHETIC_COUNT, fonts: [] });
  const CASES: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
    ["make it glow", new Set(["ADBE Glo2"])],
    ["soften the background", BLUR_MATCH_NAMES],
    ["key out the green screen", new Set(["Keylight 1.2"])],
    ["add a soft shadow behind the logo", new Set(["ADBE Drop Shadow"])],
  ];
  for (const [request, accepted] of CASES) {
    test(`"${request}" is found among ${SYNTHETIC_COUNT} extra candidates in at most 4 requests`, async () => {
      const before = suite.requests();
      const terms = await resolveRequestTerms(live.service, request, sourcesOf(padded));
      const effect = terms.find((term) => term.kind === "effect");
      suite.checkWhere(effect !== undefined && accepted.has(effect.key), `${request} -> ${effect?.key}`);
      assert.ok(suite.requests() - before <= 4, `${suite.requests() - before} requests`);
    });
  }
  test("the tournament suite is timed", () => { suite.finish(); });
});

describe("live font pre-resolution", { skip: SKIP }, () => {
  const live = liveService();
  const suite = new Suite("fonts", live.meter, 0.87);
  const profile = hostProfile({ padding: 0, fonts: SYSTEM_FONTS });
  const CASES: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
    ["set the title in Helvetica Neue", new Set(["Helvetica Neue"])],
    ["set the code in Courier", new Set(["Courier New"])],
    ["use Gill for the subtitle", new Set(["Gill Sans"])],
    ["use Helvetica Nueue for the title", new Set(["Helvetica Neue"])],
    ["use a heavy condensed display face like Impact", new Set(["Impact"])],
    ["write the caption in Times", new Set(["Times New Roman"])],
    ["use the Windows interface font Segoe", new Set(["Segoe UI"])],
    ["type it in a playful comic font", new Set(["Comic Sans MS"])],
  ];
  for (const [request, accepted] of CASES) {
    test(`"${request}" resolves to an installed family`, async () => {
      const terms = await resolveRequestTerms(live.service, request, sourcesOf(profile));
      const font = terms.find((term) => term.kind === "font");
      suite.checkWhere(font !== undefined && accepted.has(font.key), `${request} -> ${font?.key}`);
    });
  }
  test("the fonts suite is timed", () => { suite.finish(); });
});

describe("live preference tie-break", { skip: SKIP }, () => {
  const directory = mkdtempSync(join(tmpdir(), "live-tally-"));
  after(() => { rmSync(directory, { recursive: true, force: true }); });
  const live = liveService();
  const suite = new Suite("preference tie-break", live.meter, 0.66);
  test("a habit for Fast Box Blur makes 'blur it' pick Fast Box Blur", async () => {
    const tally = new PreferenceTally(directory, () => Date.now(), () => true);
    for (let plan = 0; plan < 8; plan += 1) tally.noteApplied(`plan-${plan}`, [{ type: "ensure_effect", effectMatchName: "ADBE Box Blur2" }]);
    const terms = await resolveRequestTerms(live.service, "blur it", { ...sourcesOf(), preferences: tally });
    suite.check(terms.find((term) => term.kind === "effect")?.key, "ADBE Box Blur2", "blur it with a Fast Box Blur habit");
  });
  test("without the habit 'blur it' picks the plain Gaussian Blur", async () => {
    const terms = await resolveRequestTerms(live.service, "blur it", sourcesOf());
    suite.check(terms.find((term) => term.kind === "effect")?.key, "ADBE Gaussian Blur 2", "blur it with no habit");
  });
  test("an explicit request still beats the habit", async () => {
    const tally = new PreferenceTally(directory, () => Date.now(), () => true);
    const terms = await resolveRequestTerms(live.service, "use a Gaussian Blur on the background", { ...sourcesOf(), preferences: tally });
    suite.check(terms.find((term) => term.kind === "effect")?.key, "ADBE Gaussian Blur 2", "explicit Gaussian Blur against a Fast Box Blur habit");
  });
  test("the tie-break suite is timed", () => { suite.finish(); });
});

