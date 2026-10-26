// The font substitute: installed families only, ranked by the look asked, the real face of the style asked for, and a missing name read only from the request's two shapes.
import assert from "node:assert/strict";
import test from "node:test";
import { faceFor, familyLook, knownFamiliesNamedIn, missingNamedFont, styleAskedIn, substituteFamilies } from "../src/index.js";
import type { FontRecord } from "../src/index.js";

const face = (family: string, style: string): FontRecord => ({ family, style, postScriptName: `${family.replace(/\s+/g, "")}-${style.replace(/\s+/g, "")}` });
const INSTALLED: FontRecord[] = [
  face("Arial", "Regular"), face("Arial", "Bold"), face("Arial", "Italic"), face("Arial", "Bold Italic"),
  face("Verdana", "Regular"), face("Verdana", "Bold"), face("Georgia", "Regular"), face("Courier New", "Regular"),
];

test("a substitute is always an installed family, and a request with no look gets a neutral sans", () => {
  const offered = substituteFamilies("visby bold italic", INSTALLED);
  assert.ok(offered.length > 0, "an installed sans is offered");
  for (const family of offered) assert.ok(INSTALLED.some((record) => record.family === family), `${family} is installed`);
  assert.equal(offered.includes("Georgia") && offered.indexOf("Georgia") < offered.indexOf("Arial"), false, "a serif is not the neutral sans");
  assert.equal(offered.includes("Courier New"), false, "a mono family is not offered for a neutral sans");
});

test("a substitute with no installed family that fits offers nothing rather than an uninstalled one", () => {
  assert.deepEqual(substituteFamilies("visby", []), []);
  assert.deepEqual(substituteFamilies("visby", [face("Wingdings", "Regular")]), []);
});

test("the face of a substitute keeps bold and italic as real styles where the family has them", () => {
  const both = faceFor(INSTALLED, "Arial", { bold: true, italic: true });
  assert.equal(both?.record.style, "Bold Italic");
  assert.equal(both?.exact, true);
  const bold = faceFor(INSTALLED, "Verdana", { bold: true, italic: true });
  assert.equal(bold?.record.style, "Bold", "no Bold Italic face: the nearest real style, not a faux one");
  assert.equal(bold?.exact, false);
  assert.equal(faceFor(INSTALLED, "Nope", { bold: false, italic: false }), undefined);
});

test("a request names a missing font only from 'in <name> <style>' or '<name> font'", () => {
  assert.deepEqual(styleAskedIn("title in visby bold italics"), { bold: true, italic: true });
  assert.equal(missingNamedFont("Make the title in visby bold italics", INSTALLED)?.name, "visby");
  assert.equal(missingNamedFont("Use the Visby font for the title", INSTALLED)?.name, "Visby");
  assert.equal(missingNamedFont("Make the title in Arial bold", INSTALLED), undefined, "an installed name is not missing");
  assert.equal(missingNamedFont("Make the title font bold and bigger", INSTALLED), undefined, "a layer role is not a font name");
  assert.equal(missingNamedFont("Make the box red in front bold", INSTALLED), undefined, "a common word is not a font name");
});

test("a question names a known family only when it is about a font", () => {
  assert.deepEqual(knownFamiliesNamedIn("Use Montserrat as the font, or Arial?"), ["arial", "montserrat"]);
  assert.deepEqual(knownFamiliesNamedIn("Should the impact be bigger?"), [], "no font cue, no family");
  assert.equal(familyLook("Montserrat"), "sans geometric");
  assert.equal(familyLook("Visby"), "", "a name the tables do not know has no look");
});

test("a missing serif or didone is offered serif faces first, never a sans ahead of them", () => {
  const serifs = [face("Arial", "Regular"), face("Calibri", "Regular"), face("Segoe UI", "Regular"), face("Yu Gothic", "Regular"), face("Georgia", "Regular"), face("Times New Roman", "Regular"), face("Bodoni 72", "Regular")];
  assert.deepEqual(substituteFamilies("Didot", serifs), ["Bodoni 72", "Times New Roman", "Georgia"], "the didone and the serifs, not the sans the request never asked for");
  assert.deepEqual(substituteFamilies("Didot font", serifs), ["Bodoni 72", "Times New Roman", "Georgia"], "a font cue after the name is not a different look");
  assert.deepEqual(substituteFamilies("Didot bold italic", serifs), ["Bodoni 72", "Times New Roman", "Georgia"], "the style asked is not part of the look");
  assert.deepEqual(substituteFamilies("serif", serifs), ["Bodoni 72", "Georgia", "Times New Roman"], "a serif named by a look is the same class");
});

test("a known typeface whose look no installed family holds gets the neutral sans, a missing serif included when no serif is installed", () => {
  const sansOnly = [face("Arial", "Regular"), face("Verdana", "Regular")];
  assert.deepEqual(substituteFamilies("Papyrus", sansOnly), ["Arial", "Verdana"], "a display face with nothing like it is answered with the neutral sans, as before");
  assert.deepEqual(substituteFamilies("Didot", [face("Arial", "Regular")]), ["Arial"], "a missing serif with no serif installed is the sans the fallback offers, never a serif that is not installed");
  assert.deepEqual(substituteFamilies("Didot", []), [], "an empty list offers nothing");
});

test("a bitmap face is never offered as a substitute, by the host's own technology metadata (symbol is not filtered, and an unknown technology never is)", () => {
  const typed = (family: string, technology: string): FontRecord => ({ ...face(family, "Regular"), technology });
  const offered = substituteFamilies("didot", [typed("MS Serif", "CT_BITMAP"), typed("Courier", "bitmap"), typed("Garamond", "7"), face("Georgia", "Regular")]);
  assert.equal(offered.includes("MS Serif") || offered.includes("Courier"), false);
  assert.ok(offered.includes("Georgia") && offered.includes("Garamond"), "an unknown technology is not filtered");
});
