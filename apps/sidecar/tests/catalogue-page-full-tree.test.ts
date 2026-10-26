/** The sidecar takes the whole control tree the host reads: rows past 96, levels past 3 and menus past 64 items are kept, not refused. */
import type { JsonObject } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { parseCataloguePage, type CatalogueControlRow } from "../src/catalogue-page.js";
import { catalogueProbeTitle } from "../src/catalogue-definitions.js";
import { catalogueInstanceTitle } from "../src/catalogue-instance-definitions.js";

const leaf = (matchName: string, index: number, items: string[] | null = null): JsonObject => ({ matchName, name: matchName, index, kind: "property", valueType: "OneD", defaultValue: 1, isDropdown: items !== null, items });
const group = (matchName: string, index: number, children: JsonObject[]): JsonObject => ({ matchName, name: matchName, index, kind: "group", childCount: children.length, children });

function bigEffect(): JsonObject {
  const controls = Array.from({ length: 300 }, (_, index) => leaf(`BIG-${index + 1}`, index + 1));
  const menu = leaf("BIG-MENU", 301, Array.from({ length: 100 }, (_, index) => `Mode ${index + 1}`));
  let deep = group("BIG-G6", 1, [leaf("BIG-DEEP", 1)]);
  for (let level = 5; level >= 1; level -= 1) deep = group(`BIG-G${level}`, level === 1 ? 302 : 1, [deep]);
  return { matchName: "BIG Effect", displayName: "Big Effect", controls: [...controls, menu, deep], truncated: false, applyMs: 4, createdItems: 0 };
}

function descend(row: CatalogueControlRow | undefined, levels: number): CatalogueControlRow | undefined {
  return levels === 0 ? row : descend(row?.children.at(0), levels - 1);
}

test("a probe page with a big effect is parsed whole", () => {
  const outcome = parseCataloguePage({ ok: true, requestId: "t1", host: { version: "26.2.1", build: "2" }, results: [bigEffect()], failures: [], remaining: [], elapsedMs: 5 }, "t1", ["BIG Effect"]);
  assert.equal(outcome.kind, "page");
  if (outcome.kind !== "page") return;
  const controls = outcome.page.results.at(0)?.controls ?? [];
  assert.equal(controls.length, 302);
  assert.equal(controls.find((row) => row.matchName === "BIG-MENU")?.items?.length, 100);
  assert.equal(descend(controls.at(-1), 6)?.matchName, "BIG-DEEP");
});

test("probes and instance reads from before the full-tree read are not taken as collected", () => {
  assert.match(catalogueProbeTitle("2", "1.0"), /full tree\)$/);
  assert.match(catalogueInstanceTitle("2", "1.0"), /full tree\)$/);
});
