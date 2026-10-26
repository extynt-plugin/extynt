// Tests the font inventory built from a host font census.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FONT_RESULTS, MAX_FONT_NAME_CHARS, MAX_FONT_RECORDS, MAX_FONT_RESULTS, compareFontRecords, emptyFontInventory, fontCensus, fontInventoryFromCensus, fontsAreAuthoritative, makeFontInventory, nearestFontFamilies, searchFonts } from "../src/index.js";
import type { FontCensusFields } from "../src/index.js";
import { decode } from "@extynt/decode";
import type { JsonValue } from "@extynt/decode";

const style = (family: string, styleName: string, postScriptName = `${family}-${styleName}`.replace(/\s+/g, "")) => ({ family, style: styleName, postScriptName });

test("a font census is normalised, de-duplicated by PostScript name, and deterministically ordered", () => {
  const inventory = makeFontInventory([
    style("Helvetica", "Bold"),
    { family: "  Helvetica  ", style: "Bold", postScriptName: "Helvetica-Bold" },
    { family: "Helvetica", style: "Bold", postScriptName: " Helvetica-Bold " },
    { family: "Helvetica", style: "Regular", postScriptName: "Helvetica" },
    style("Inter", "Black"),
    { family: "Inter", style: "Black", postScriptName: "" },
    { family: "Inter\u0000 Tight", style: "Semi\u001fBold", postScriptName: `Inter-${"x".repeat(300)}` },
  ], { familiesReported: 2 });

  assert.deepEqual(inventory.items.map((record) => record.postScriptName), ["Helvetica-Bold", "Helvetica", "Inter-Black", `Inter-${"x".repeat(MAX_FONT_NAME_CHARS - "Inter-".length)}`]);
  assert.equal(inventory.items[2]?.family, "Inter");
  assert.equal(inventory.items[3]?.family, "Inter Tight");
  assert.equal(inventory.items[3]?.style, "Semi Bold", "control characters must not survive into a prompt");
  assert.equal(inventory.items[3]?.postScriptName.length, MAX_FONT_NAME_CHARS);
  assert.equal(inventory.truncated, false);
  assert.equal(inventory.completeness, "complete");
  assert.equal(inventory.totalReported, 4, "a census that carried every style it read is not truncated");
  assert.equal(inventory.familiesReported, 2);
  assert.deepEqual(makeFontInventory(inventory.items, { familiesReported: 2 }), inventory);
  assert.notEqual(makeFontInventory([...inventory.items, style("Zapfino", "Regular")]).fingerprint, inventory.fingerprint);
  assert.equal(inventory.items.some((record) => record.postScriptName === ""), false);
});

test("the font cap is hard, and truncation is a sorted prefix that says so", () => {
  const many = Array.from({ length: MAX_FONT_RECORDS + 37 }, (_, index) => style(`Family ${String(index).padStart(5, "0")}`, "Regular"));
  const inventory = makeFontInventory(many);
  assert.equal(inventory.items.length, MAX_FONT_RECORDS);
  assert.equal(inventory.truncated, true);
  assert.equal(inventory.completeness, "partial", "a census that stopped early must not read as complete");
  assert.equal(inventory.totalReported, many.length);
  assert.equal(fontsAreAuthoritative(inventory), false);
  const shuffled = makeFontInventory([...many].reverse());
  assert.deepEqual(shuffled.items, inventory.items, "the truncation rule must not depend on the order the host listed fonts in");
  assert.deepEqual(inventory.items, [...inventory.items].sort(compareFontRecords));
  assert.equal(inventory.items.at(-1)?.family, `Family 0${MAX_FONT_RECORDS - 1}`);
  const declared = makeFontInventory(many.slice(0, 10), { truncated: true, totalReported: many.length, familiesReported: many.length });
  assert.equal(declared.items.length, 10);
  assert.equal(declared.truncated, true);
  assert.equal(declared.completeness, "partial");
});

function decodedCensus(input: JsonValue): FontCensusFields | undefined {
  const result = decode(fontCensus, input);
  return result.ok ? result.value : undefined;
}

test("a host that reports no fonts yields an empty census, never a default font", () => {
  for (const [label, inventory] of [
    ["missing", fontInventoryFromCensus(undefined)],
    ["empty result", fontInventoryFromCensus({})],
    ["unreadable list", fontInventoryFromCensus(decodedCensus({ installedFonts: "Helvetica" }))],
    ["blank names", fontInventoryFromCensus({ installedFonts: [{ family: "", style: "", postScriptName: "   " }], fontCompleteness: "failed" })],
  ] as const) {
    assert.deepEqual(inventory.items, [], `${label}: an unenumerated host has no fonts to offer`);
    assert.equal(inventory.familiesReported, 0, label);
    assert.equal(fontsAreAuthoritative(inventory), false, label);
  }
  const blank = fontInventoryFromCensus({ installedFonts: [{ postScriptName: "" }], fontCompleteness: "failed" });
  assert.equal(blank.items.length, 0);
  assert.equal(blank.totalReported, 1, "the offered style is counted, not silently dropped from the facts");
  assert.equal(blank.truncated, true, "a style that was offered and not carried is a partial census");
  const none = fontInventoryFromCensus({ installedFonts: [], fontCompleteness: "complete" });
  assert.deepEqual(none.items, []);
  assert.equal(fontsAreAuthoritative(none), true);
  assert.equal(emptyFontInventory().completeness, "failed");
  assert.equal(JSON.stringify([none, emptyFontInventory()]).includes("Helvetica"), false, "no default font may be invented for a host that reported none");
});

test("the census envelope is read field by field, and a partial host is labelled partial", () => {
  const inventory = fontInventoryFromCensus({
    installedFonts: [style("Helvetica", "Bold"), style("Helvetica", "Regular"), style("Inter", "Black")],
    fontTotalReported: 2312,
    fontFamiliesReported: 574,
    fontCompleteness: "partial",
  });
  assert.equal(inventory.items.length, 3);
  assert.equal(inventory.totalReported, 2312);
  assert.equal(inventory.familiesReported, 574);
  assert.equal(inventory.completeness, "partial");
  assert.equal(fontsAreAuthoritative(inventory), false);
  assert.equal(inventory.truncated, true, "a partial census is truncated by definition, so absence is not proof of absence");
});

test("font search is bounded, deterministic, and case-insensitive across every field", () => {
  const inventory = makeFontInventory([
    style("Helvetica", "Bold", "Helvetica-Bold"),
    style("Helvetica Neue", "Light", "HelveticaNeue-Light"),
    style("Inter", "Black", "Inter-Black"),
    style("Inter", "Bold", "Inter-Bold"),
    style("Zapfino", "Regular", "Zapfino"),
  ]);
  const first = searchFonts(inventory, "", DEFAULT_FONT_RESULTS);
  assert.deepEqual(first.items.map((record) => record.postScriptName), inventory.items.map((record) => record.postScriptName));
  assert.equal(first.total, 5);
  assert.equal(first.truncated, false);
  assert.deepEqual(searchFonts(inventory, "helv").items.map((record) => record.postScriptName), ["Helvetica-Bold", "HelveticaNeue-Light"]);
  assert.deepEqual(searchFonts(inventory, "BOLD").items.map((record) => record.postScriptName), ["Helvetica-Bold", "Inter-Bold"]);
  assert.deepEqual(searchFonts(inventory, "Inter-Black").items.map((record) => record.postScriptName), ["Inter-Black"], "the PostScript name is searchable, not only the family");
  assert.equal(searchFonts(inventory, "Papyrus").total, 0, "a font this host does not list must not be answered with something similar");
  assert.deepEqual(searchFonts(inventory, "Papyrus").items, []);
  const wide = makeFontInventory(Array.from({ length: 120 }, (_, index) => style(`Fam ${String(index).padStart(3, "0")}`, "Regular")));
  assert.equal(searchFonts(wide, "", 500).items.length, MAX_FONT_RESULTS);
  assert.equal(searchFonts(wide, "", 500).total, 120);
  const page = searchFonts(wide, "", 10, 20);
  assert.deepEqual(page.items, wide.items.slice(20, 30));
  assert.equal(page.total, 120);
  assert.equal(page.returned, 10);
  assert.equal(page.truncated, true);
  assert.deepEqual(searchFonts(wide, "", 10, 20), page, "paging must be a pure function of the census and the offset");
});

test("font search matches a query word by word, never the whole sentence and never OR", () => {
  const inventory = makeFontInventory([
    style("Helvetica", "Bold", "Helvetica-Bold"),
    style("Helvetica Neue", "Bold", "HelveticaNeue-Bold"),
    style("Helvetica Neue", "Light", "HelveticaNeue-Light"),
    style("Inter", "Black", "Inter-Black"),
    style("Inter", "Bold", "Inter-Bold"),
    style("Zapfino", "Regular", "Zapfino"),
  ]);
  assert.deepEqual(searchFonts(inventory, "Helvetica Bold").items.map((record) => record.postScriptName), ["Helvetica-Bold", "HelveticaNeue-Bold"]);
  assert.deepEqual(searchFonts(inventory, "helvetica neue light").items.map((record) => record.postScriptName), ["HelveticaNeue-Light"], "three words spread across family and style resolve too");
  assert.deepEqual(searchFonts(inventory, "Helvetica Papyrus").items, []);
  assert.equal(searchFonts(inventory, "Helvetica Papyrus").total, 0);
  assert.deepEqual(searchFonts(inventory, "Papyrus Quasar").items, []);
  const first = searchFonts(inventory, "Helvetica Bold", 1);
  assert.deepEqual(first.items.map((record) => record.postScriptName), ["Helvetica-Bold"]);
  assert.equal(first.total, 2);
  assert.equal(first.returned, 1);
  assert.equal(first.truncated, true);
  const second = searchFonts(inventory, "Helvetica Bold", 1, 1);
  assert.deepEqual(second.items.map((record) => record.postScriptName), ["HelveticaNeue-Bold"]);
  assert.equal(second.total, 2);
  assert.equal(second.truncated, false);
  const wide = makeFontInventory(Array.from({ length: 120 }, (_, index) => style(`Fam ${String(index).padStart(3, "0")}`, "Regular")));
  assert.equal(searchFonts(wide, "Fam Regular", 500).items.length, MAX_FONT_RESULTS);
  assert.equal(searchFonts(wide, "Fam Regular", 500).total, 120);
  assert.deepEqual(searchFonts(inventory, "bold").items.map((record) => record.postScriptName), ["Helvetica-Bold", "HelveticaNeue-Bold", "Inter-Bold"]);
  assert.deepEqual(searchFonts(inventory, "helv").items.map((record) => record.postScriptName), ["Helvetica-Bold", "HelveticaNeue-Bold", "HelveticaNeue-Light"]);
  assert.deepEqual(searchFonts(inventory, "").items, inventory.items);
});

test("nearestFontFamilies offers installed families by whole-name containment, then shared words, best first", () => {
  const inventory = makeFontInventory([
    style("Helvetica", "Bold", "Helvetica-Bold"),
    style("Helvetica Neue", "Bold", "HelveticaNeue-Bold"),
    style("Helvetica Neue", "Light", "HelveticaNeue-Light"),
    style("Inter", "Bold", "Inter-Bold"),
    style("Zapfino", "Regular", "Zapfino"),
  ]);
  assert.deepEqual(nearestFontFamilies(inventory, "helvetica neue condensed"), ["Helvetica Neue", "Helvetica"]);
  assert.deepEqual(nearestFontFamilies(inventory, "Interstate"), ["Inter"], "a word that contains a family name is near it");
  assert.deepEqual(nearestFontFamilies(inventory, "Papyrus"), []);
  assert.deepEqual(nearestFontFamilies(inventory, ""), []);
  assert.deepEqual(nearestFontFamilies(inventory, "helvetica", 1), ["Helvetica"]);
});
