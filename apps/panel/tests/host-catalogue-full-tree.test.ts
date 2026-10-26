/** catalogue.jsx reads an effect's whole control tree: rows past the old 96, groups past the old 3 levels and menus past the old 64 items. */

import assert from "node:assert/strict";
import test from "node:test";
import { loadHostFiles } from "./host-sources.js";
import { loadHostContext } from "./host-vm-context.js";
import { type Found, fieldOf, listAt, readJson, recordsAt, recordsOr, textAt } from "./json-narrow.js";
import { type JsonObject } from "@extynt/decode";

const PROPERTY = 6212, GROUP = 6213, ONE_D = 6417;
type Fake = { matchName: string; name: string; propertyType: number; propertyValueType?: number; numProperties: number; value?: number; isDropdownEffect?: boolean; propertyParameters?: string[]; property(index: number | string): Fake | null };

function leaf(matchName: string, extra: Partial<Fake> = {}): Fake {
  return { matchName, name: matchName, propertyType: PROPERTY, propertyValueType: ONE_D, numProperties: 0, value: 1, property: () => null, ...extra };
}
function group(matchName: string, children: Fake[]): Fake {
  return { matchName, name: matchName, propertyType: GROUP, numProperties: children.length, property: (index) => (typeof index === "number" ? children[index - 1] ?? null : null) };
}

function bigEffect(): Fake {
  const controls = Array.from({ length: 300 }, (_, index) => leaf(`BIG-${String(index + 1).padStart(4, "0")}`));
  const menu = leaf("BIG-MENU", { isDropdownEffect: true, propertyParameters: Array.from({ length: 100 }, (_, index) => `Mode ${index + 1}`) });
  let deep = group("BIG-G6", [leaf("BIG-DEEP")]);
  for (let level = 5; level >= 1; level -= 1) deep = group(`BIG-G${level}`, [deep]);
  return { ...group("BIG Effect", [...controls, menu, deep]), name: "Big Effect" };
}

type FakeLayer = { id: number; property(name: string): Fake | null };

function readInstance(): Found {
  class CompItem {
    id = 7;
    numLayers = 1;
    layer = (): FakeLayer => ({ id: 3, property: (name) => (name === "ADBE Effect Parade" ? group("ADBE Effect Parade", [bigEffect()]) : null) });
  }
  const comp = new CompItem();
  const app = { version: "26.2.1", buildNumber: 2, project: { numItems: 1, item: () => comp } };
  const host = loadHostContext({ app, CompItem, PropertyType: { PROPERTY, INDEXED_GROUP: 6214, NAMED_GROUP: GROUP }, PropertyValueType: { OneD: ONE_D } });
  loadHostFiles(host.context, "host-shared.jsx");
  loadHostFiles(host.context, "catalogue.jsx");
  const request = JSON.stringify({ schemaVersion: "0.1", requestId: "r1", matchName: "BIG Effect", compId: "7", layerId: "3", effectIndex: 1 });
  return readJson(textAt(host.call(`aeCatalogueReadInstance(${JSON.stringify(request)})`)));
}

function firstChild(row: JsonObject | undefined): JsonObject | undefined {
  return row === undefined ? undefined : recordsOr(row, "children")[0];
}

test("an instance read keeps every row, every level and every menu item of a big effect", () => {
  const answer = readInstance();
  assert.equal(fieldOf(answer, "ok"), true, JSON.stringify(answer).slice(0, 300));
  const controls = recordsAt(answer, "instance", "controls");
  assert.equal(fieldOf(answer, "instance", "truncated"), false);
  assert.equal(controls.length, 302, "300 controls, the menu and the deep group");
  const menu = controls.find((row) => fieldOf(row, "matchName") === "BIG-MENU");
  assert.equal(listAt(menu, "items").length, 100);
  let deep = controls.at(-1);
  for (let level = 1; level <= 6; level += 1) deep = firstChild(deep);
  assert.equal(fieldOf(deep, "matchName"), "BIG-DEEP", "the leaf six groups down is read");
});
