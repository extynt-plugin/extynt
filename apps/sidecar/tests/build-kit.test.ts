/** The MCP build kit: the panel's up-front material for a request, from the same functions, in MCP wording and a bounded size. */
import { representativeSnapshot } from "@extynt/project-graph";
import type { FontInventory } from "@extynt/capability-catalogue";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildAgentBriefing, estimateTokens } from "../src/agent.js";
import { COMMON_OPERATION_SHAPES, VALUES_AND_UNITS } from "../src/agent-briefing.js";
import { buildKit, safeDefaultFont } from "../src/build-kit.js";
import { requestedOperationTypes } from "../src/request-coverage.js";

const S4_PROMPT = readFileSync(new URL("../../tests/fixtures/s4-prompt.txt", import.meta.url), "utf8");
const KIT_TOKEN_BUDGET = 6000;
const FONTS: FontInventory = { items: [{ family: "Zapf", style: "Regular", postScriptName: "Zapf-Regular" }, { family: "Arial", style: "Bold", postScriptName: "Arial-BoldMT" }, { family: "Arial", style: "Regular", postScriptName: "ArialMT" }], truncated: false, completeness: "complete", totalReported: 3, familiesReported: 2, fingerprint: "f" };

test("the S4 kit carries the shapes, the schemas and the resolved examples for every feature it names", () => {
  const kit = buildKit(S4_PROMPT, "comp-main", FONTS);
  for (const needle of ["create_layer", "animate_property", "add_marker", "set_layer_parent", "add_text_animator", "ensure_effect", "dolly_camera", "ADBE Ramp", "repeater", "Values and units:"]) assert.ok(kit.includes(needle), `kit lacks ${needle}`);
  for (const type of requestedOperationTypes(S4_PROMPT)) assert.ok(kit.includes(`${type} — `), `kit lacks the schema row for ${type}`);
  assert.ok(kit.includes("ArialMT"), "names a safe default font from the host list");
  assert.ok(estimateTokens(kit) <= KIT_TOKEN_BUDGET, `kit is ${estimateTokens(kit)} tokens`);
});

test("the kit speaks of plans, never the panel agent's queue", () => {
  assert.doesNotMatch(buildKit(S4_PROMPT, "comp-main", FONTS), /queue/i);
});

test("the kit and the panel briefing share their text, and the briefing keeps its content order", () => {
  const briefing = buildAgentBriefing(representativeSnapshot, { providerName: "DeepSeek", requestGoal: S4_PROMPT });
  assert.ok(briefing.includes(VALUES_AND_UNITS));
  assert.ok(briefing.indexOf(VALUES_AND_UNITS) < briefing.indexOf(COMMON_OPERATION_SHAPES[0] ?? ""), "values precede the shapes");
  assert.ok(briefing.includes(COMMON_OPERATION_SHAPES.join("\n")));
});

test("a request naming no feature still gets shapes and units, and the safe font needs a listed family", () => {
  const kit = buildKit("Make the title bigger", "", undefined);
  assert.ok(kit.includes("Common operation shapes") && kit.includes("Values and units:"));
  assert.equal(safeDefaultFont(undefined), undefined);
  assert.equal(safeDefaultFont({ ...FONTS, items: FONTS.items.slice(0, 1) }), undefined);
  assert.equal(safeDefaultFont(FONTS), "ArialMT");
});

test("the kit lists host read-back failures only for operations the request needs", () => {
  const evidence = { add_marker: { count: 1, lastVerifiedAt: "t", hostVersion: "26", failures: 2, lastFailureBasis: "mismatch" }, add_text_animator: { count: 0, lastVerifiedAt: "t", hostVersion: "26", failures: 1 }, create_solid_unused: { count: 0, lastVerifiedAt: "t", hostVersion: "26", failures: 3 } };
  const kit = buildKit(S4_PROMPT, "comp-main", FONTS, evidence);
  assert.match(kit, /failed to read back before/);
  assert.match(kit, /- add_marker \(mismatch, 2 failures\)/);
  assert.doesNotMatch(kit, /create_solid_unused/);
  assert.doesNotMatch(buildKit(S4_PROMPT, "comp-main", FONTS, {}), /failed to read back before/);
  assert.doesNotMatch(buildKit(S4_PROMPT, "comp-main", FONTS), /failed to read back before/);
});

test("a drawn-scene request adds the SVG route and the designer's authoring rules; the S4 kit does not", () => {
  const kit = buildKit("Draw a rocket orbiting a ringed planet over a starfield", "comp-main", FONTS);
  assert.ok(kit.includes("ae_propose_plan {svg}") && kit.includes("data-repeat") && kit.includes("svgScene.layers"));
  assert.doesNotMatch(kit, /queue/i);
  assert.ok(estimateTokens(kit) <= KIT_TOKEN_BUDGET, `kit is ${estimateTokens(kit)} tokens`);
  assert.ok(!buildKit(S4_PROMPT, "comp-main", FONTS).includes("ae_propose_plan {svg}"));
});

test("a request to make a cycle from an existing comp surfaces duplicate_composition with its schema row", () => {
  for (const request of ["digest becky's walk cycle, and make a run, jump, and fall cycle from the walk comp", "duplicate the Walk composition as a Run variant"]) {
    assert.ok(requestedOperationTypes(request).includes("duplicate_composition"), request);
    const kit = buildKit(request, "comp-main", FONTS);
    assert.ok(kit.includes("duplicate_composition — "), `kit lacks the schema row for duplicate_composition: ${request}`);
  }
  assert.ok(!requestedOperationTypes("add a glow to the title").includes("duplicate_composition"));
});

const SUBSTITUTE_FONTS: FontInventory = {
  items: [
    { family: "Arial", style: "Bold", postScriptName: "Arial-BoldMT" }, { family: "Arial", style: "Bold Italic", postScriptName: "Arial-BoldItalicMT" },
    { family: "Arial", style: "Italic", postScriptName: "Arial-ItalicMT" }, { family: "Arial", style: "Regular", postScriptName: "ArialMT" },
    { family: "Verdana", style: "Regular", postScriptName: "Verdana" }, { family: "Verdana", style: "Bold", postScriptName: "Verdana-Bold" },
    { family: "Courier New", style: "Regular", postScriptName: "CourierNewPSMT" },
  ],
  truncated: false, completeness: "complete", totalReported: 7, familiesReported: 3, fingerprint: "s",
};
const MISSING_REQUEST = "Make a title in visby bold italics";

test("a request naming an uninstalled font gets an installed substitute, bold italic kept as a real style, and no question", () => {
  const kit = buildKit(MISSING_REQUEST, "comp-main", SUBSTITUTE_FONTS);
  assert.match(kit, /names "visby", which is not installed on this host/);
  assert.match(kit, /Use the installed substitute "Arial" as Arial-BoldItalicMT \(Bold Italic\)/);
  assert.match(kit, /Do not ask the user about it/);
  assert.match(kit, /Say in your reply which font you used/);
  assert.doesNotMatch(kit, /Proxima|Montserrat/);
  for (const line of kit.split("\n").filter((text) => text.includes("installed substitute"))) {
    assert.doesNotMatch(line, /Courier/, "a substitute is not a mono family");
  }
});

test("the missing-font line offers only installed alternatives, and a Verdana bold italic falls back to the nearest real style", () => {
  const kit = buildKit(MISSING_REQUEST, "comp-main", SUBSTITUTE_FONTS);
  assert.match(kit, /Alternatives, all installed: "Verdana" as Verdana-Bold/);
  assert.match(kit, /nearest real style/);
  assert.doesNotMatch(kit, /Courier New" as CourierNew/, "a mono family is never offered for this sans request");
});

test("a partial or loading font census never says a named font is missing", () => {
  const partial: FontInventory = { ...SUBSTITUTE_FONTS, completeness: "partial", truncated: true };
  const loading: FontInventory = { ...SUBSTITUTE_FONTS, loading: true };
  for (const fonts of [partial, loading, undefined]) {
    const kit = buildKit(MISSING_REQUEST, "comp-main", fonts);
    assert.doesNotMatch(kit, /not installed on this host/, "no claim of a missing font");
    assert.doesNotMatch(kit, /installed substitute/);
  }
});

test("a request with no font name keeps the default font line", () => {
  assert.match(buildKit("Make the title bigger", "comp-main", SUBSTITUTE_FONTS), /omit font to keep the text layer's default, or use "ArialMT"/);
});
