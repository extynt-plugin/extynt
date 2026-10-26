// Tests that a font search which finds nothing but offers stand-ins records the requested name and the offered families on the context.
import test from "node:test";
import assert from "node:assert/strict";
import { makeFontInventory, makeHostProfile, makeInventory, makePresetInventory } from "@extynt/capability-catalogue";
import { callTool } from "../src/index.js";
import type { FontSubstitution } from "../src/index.js";

const host = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "Windows", architecture: "x64" };
const record = (family: string) => ({ family, style: "Regular", postScriptName: family.replace(/\s+/g, "") });
const profile = makeHostProfile(makeInventory(host, []), undefined, makePresetInventory([]), makeFontInventory([record("Times New Roman"), record("Arial")], { familiesReported: 2 }));

test("a search for an uninstalled font records it with the installed families offered", () => {
  const seen: FontSubstitution[] = [];
  callTool("ae_search_fonts", { query: "didot" }, { hostProfile: profile, noteFontSubstitution: (substitution) => { seen.push(substitution); } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.requested, "didot");
  assert.ok(seen[0]?.offered.includes("Times New Roman"));
});

test("a search that finds the font records nothing", () => {
  const seen: FontSubstitution[] = [];
  callTool("ae_search_fonts", { query: "arial" }, { hostProfile: profile, noteFontSubstitution: (substitution) => { seen.push(substitution); } });
  assert.deepEqual(seen, []);
});
