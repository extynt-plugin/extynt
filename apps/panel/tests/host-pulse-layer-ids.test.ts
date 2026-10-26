/** The pulse yields exactly one layer-id entry per layer, even when a layer's selection flag or the layer itself cannot be read. */

import assert from "node:assert/strict";
import test from "node:test";
import { loadHostContext } from "./host-vm-context.js";
import { textAt } from "./json-narrow.js";

const SCRIPT = `(function () {
  var layers = [
    { id: 7, get selected() { throw new Error("selected unreadable"); } },
    { id: 8, selected: true },
    null,
    { get id() { throw new Error("id unreadable"); }, selected: true },
    { id: 11, selected: false }
  ];
  var active = { numLayers: layers.length, layer: function (i) { if (!layers[i - 1]) throw new Error("layer unreadable"); return layers[i - 1]; } };
  var state = {};
  aePulseLayerIds(active, state);
  return state;
})()`;

test("a throwing selection flag keeps the layer's id once and counts the layer as not selected; an unreadable layer is one 0", () => {
  const state = loadHostContext().call(SCRIPT);
  assert.equal(textAt(state, "layerIds"), "7,8,0,0,11");
  assert.equal(textAt(state, "selection"), "8");
});
