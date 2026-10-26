/** Host lookups keyed by ids, names and codes never reach Object.prototype: "constructor" is an unknown key, not a hit. */

import assert from "node:assert/strict";
import test from "node:test";
import { loadHostContext } from "./host-vm-context.js";
import { fieldOf, numberAt } from "./json-narrow.js";

const PROTOTYPE_KEYS = ["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__"];

test("an error message that starts with an Object.prototype name reports HOST_MUTATION_FAILED, not that name as its code", () => {
  const host = loadHostContext();
  for (const key of PROTOTYPE_KEYS) {
    const info = host.call(`aeApplyFailureInfo(new Error(${JSON.stringify(`${key}: boom`)}))`);
    assert.equal(fieldOf(info, "code"), "HOST_MUTATION_FAILED", key);
  }
  const known = host.call('aeApplyFailureInfo(new Error("TARGET_NOT_FOUND: layer 9"))');
  assert.equal(fieldOf(known, "code"), "TARGET_NOT_FOUND", "an ordinary known code is kept");
});

test("aeOwnValue returns own properties only", () => {
  const host = loadHostContext();
  assert.equal(host.call('aeOwnValue({ a: 1 }, "a")'), 1);
  assert.equal(host.call('aeOwnValue({ a: 1 }, "b")'), undefined);
  for (const key of PROTOTYPE_KEYS) {
    assert.equal(host.call(`aeOwnValue({}, ${JSON.stringify(key)})`), undefined, key);
  }
});

test("an id named like an Object.prototype member is never a created composition, item, folder, mask or shape group", () => {
  const host = loadHostContext({ app: { project: { numItems: 0, item: () => null, rootFolder: { id: 0 } } } });
  host.call("(aeApplyCreatedComps = {}, aeApplyCreatedItems = {}, 0)");
  for (const key of PROTOTYPE_KEYS) {
    const id = JSON.stringify(key);
    assert.equal(host.call(`aeApplyStepItem({ createdFolders: {} }, ${id}) || null`), null, `item ${key}`);
    assert.equal(host.call(`aeApplyStepComp({ compositionId: ${id} }) || null`), null, `comp ${key}`);
    assert.equal(host.call(`aeApplyResolveFolder(${id}, {}) || null`), null, `folder ${key}`);
    assert.equal(host.call(`aeApplyResolveMask({}, ${id}, {}) || null`), null, `mask ${key}`);
    assert.equal(host.call(`aeApplyResolveShapeGroup({}, ${id}, {}) || null`), null, `shape group ${key}`);
  }
});

test("a created composition is still found by its plan id", () => {
  const host = loadHostContext({ app: { project: { numItems: 0, item: () => null } } });
  host.call("(aeApplyCreatedItems = {}, 0)");
  assert.equal(host.call('aeApplyStepItem({ createdFolders: { f1: { id: "f1" } } }, "f1").id'), "f1");
  assert.equal(host.call('(aeApplyCreatedComps = { c1: { id: "c1" } }, aeApplyCreatedItems = {}, aeApplyStepComp({ compositionId: "c1" }).id)'), "c1");
});

test("a composition id named like an Object.prototype member gets the default layer start and is not selected by an empty wanted map", () => {
  const host = loadHostContext();
  const script = `(function () {
    var seen = [];
    aeProbeCompData = function (item, options) { seen.push(options.start); return { id: item.id }; };
    var config = { maxReadMs: 1e9, maxTotalProperties: 1e9, maxProjectItems: 1e9 };
    aeProbeReadStartedAt = (new Date()).getTime();
    var candidate = { id: "constructor" };
    var page = aeProbeReadCompositions([candidate], { activeComp: null, wanted: null, starts: {}, config: config, softMs: 0, warnings: [] });
    var order = aeProbeCompositionOrder([candidate], null, { x: true });
    return { starts: seen, read: page.compositions.length, selected: order.length };
  })()`;
  const result = host.call(script);
  assert.deepEqual(fieldOf(result, "starts"), [{ layer: 1, property: 0 }]);
  assert.equal(numberAt(result, "read"), 1);
  assert.equal(numberAt(result, "selected"), 0);
});

test("a blend mode named like an Object.prototype member is not a blend mode", () => {
  const host = loadHostContext({ BlendingMode: { NORMAL: 1 } });
  assert.equal(host.call('aeApplyValBlendMode("NORMAL")'), true);
  for (const key of PROTOTYPE_KEYS) {
    assert.equal(host.call(`aeApplyValBlendMode(${JSON.stringify(key)})`), false, key);
  }
});
