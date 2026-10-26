// The accepted-field lists the operation validators enforce, as the repair messages read them.
import assert from "node:assert/strict";
import test from "node:test";
import { acceptedFieldsOfType, acceptedTopLevelFields, flagsField, LAYER_TARGET_KEYS } from "../src/index.js";

const TARGET = { compositionId: "comp-main", layerId: "layer-title" };

test("the accepted top-level fields are the allowlist the operation's own validator enforces", () => {
  const rename = acceptedTopLevelFields({ type: "set_layer_name", target: TARGET, name: "x" });
  assert.ok(rename?.includes("name") && rename.includes("target"));
  assert.ok(!rename?.includes("layerId"), "a layer-scoped type takes layerId inside target, not beside it");
  const property = acceptedTopLevelFields({ type: "set_layer_property", target: TARGET, propertyPath: "p", value: 1 });
  assert.ok(property?.includes("propertyPath"), "set_layer_property owns propertyPath at the top level");
  const composition = acceptedTopLevelFields({ type: "create_composition", name: "x" });
  assert.ok(composition && !composition.includes("target") && !composition.includes("layerId"), "a project-level type takes no layer target");
});

test("an operation type the validator does not know has no field list", () => {
  assert.equal(acceptedTopLevelFields({ type: "made_up_operation", target: TARGET }), undefined);
});

test("flagsField reports a field the validator calls unknown or not a target field", () => {
  assert.equal(flagsField({ type: "set_layer_name", target: TARGET, name: "x", extra: 1 }, "extra"), true);
  assert.equal(flagsField({ type: "set_layer_name", target: TARGET, name: "x" }, "extra"), false);
  assert.ok(LAYER_TARGET_KEYS.includes("layerId") && !LAYER_TARGET_KEYS.includes("groupId"));
});

test("a create_layer whose target names only a placeholder layerId still reports its allowlist", () => {
  const accepted = acceptedFieldsOfType({ type: "create_layer", layerType: "null", name: "Title Null", target: { layerId: "__new__:title_null" } });
  assert.ok(accepted?.includes("layerType") && accepted.includes("target"));
  assert.ok(!accepted?.includes("layerId"));
  const planned = acceptedFieldsOfType({ type: "create_layer", layerType: "null", name: "N", target: { compositionId: "__new__:later", layerId: "__new__:n" } });
  assert.ok(planned?.includes("layerType"), "a composition created earlier in the plan does not hide the allowlist");
});
