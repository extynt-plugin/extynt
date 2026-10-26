// Layer, text, marker, footage and render operations: parents, attributes, text documents, expressions, proxies and render authorization.
import test from "node:test";
import { representativeSnapshot, type ProjectItemSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { compositionTarget, fingerprints, footageTarget, target } from "./fixtures.js";
import { assertOperations, assertSequences } from "./plan-builders.js";

function attribute(role: string, value: JsonValue): JsonObject {
  return { type: "set_layer_attribute", target, role, value };
}

function textDocument(fields: JsonObject): JsonObject {
  return { type: "set_text_document", target, ...fields };
}

test("set_layer_parent accepts a layer created earlier in the same plan", () => {
  const tracker = { type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:tracker", ...fingerprints }, layerType: "null", name: "Tracker" } satisfies JsonObject;
  assertSequences([["ok", [tracker, { type: "set_layer_parent", target, parentLayerId: "__new__:tracker" }]]]);
});

test("set_layer_parent accepts a parent or none and rejects self-parenting or an absent parent", () => {
  assertOperations([
    ["ok", { type: "set_layer_parent", target, parentLayerId: "layer-footage" }],
    ["ok", { type: "set_layer_parent", target, parentLayerId: null }],
    ["INVALID_VALUE", { type: "set_layer_parent", target, parentLayerId: "layer-title" }],
    ["TARGET_NOT_FOUND", { type: "set_layer_parent", target: footageTarget, parentLayerId: "no-such-layer" }],
  ]);
});

test("set_layer_attribute accepts blend-mode, three-d and visibility roles and rejects unknown values", () => {
  assertOperations([
    ["ok", attribute("blend-mode", "SCREEN")],
    ["ok", attribute("three-d", true)],
    ["ok", attribute("shy", false)],
    ["INVALID_VALUE", attribute("blend-mode", "NOT_A_MODE")],
    ["INVALID_VALUE", attribute("three-d", "yes")],
  ]);
});

test("set_layer_attribute locked takes a boolean, so a plan can unlock, edit and relock a layer", () => {
  const edit = { type: "set_layer_name", target, name: "Edited" } satisfies JsonObject;
  assertSequences([["ok", [attribute("locked", false), edit, attribute("locked", true)]], ["INVALID_VALUE", [attribute("locked", "yes")]]], { bounds: { maxOperations: 8 } });
});

test("set_text_document accepts bounded typed TextDocument fields", () => {
  const fields = { text: "Hello", font: "ArialMT", fontSize: 48, fillColor: [1, 0.5, 0], justification: "CENTER_JUSTIFY", tracking: 10, leading: 55, autoLeading: false };
  assertOperations([["ok", textDocument(fields)], ["ok", textDocument({ horizontalScale: 110, verticalScale: 250, tsume: 10 })]]);
});

test("set_text_document accepts the character, paragraph and box fields", () => {
  const fields = { applyStroke: true, strokeColor: [0, 0, 0], strokeWidth: 3, lineJoinType: "LINE_JOIN_ROUND", autoKernType: "OPTICAL_KERN", tsume: 20, baselineShift: 4, horizontalScale: 90, fontCapsOption: "FONT_ALL_CAPS", fontBaselineOption: "FONT_FAUXED_SUPERSCRIPT", ligature: false, digitSet: "DEFAULT_DIGITS", firstLineIndent: 12, startIndent: 10, endIndent: 8, spaceBefore: 6, spaceAfter: 4, autoHyphenate: false, everyLineComposer: true, direction: "DIRECTION_LEFT_TO_RIGHT", boxTextSize: [800, 400], boxVerticalAlignment: "CENTER" };
  assertOperations([
    ["ok", textDocument(fields)],
    ["ok", textDocument({ characterRanges: [{ start: 0, end: 5, fontSize: 96, fillColor: [1, 0, 0], fauxBold: true }] })],
    ["ok", textDocument({ characterRanges: [{ start: 0, end: 1, kerning: 20 }] })],
  ]);
});

test("set_text_document refuses arbitrary, read-only and out-of-range fields", () => {
  assertOperations([
    ["INVALID_VALUE", textDocument({ fontSize: 0 })],
    ["UNKNOWN_FIELD", textDocument({ arbitraryAeField: "nope" })],
    ["INVALID_VALUE", textDocument({ kerning: 20 })],
    ["UNKNOWN_FIELD", textDocument({ allCaps: true })],
    ["INVALID_VALUE", textDocument({ fontCapsOption: "SHOUTY" })],
    ["INVALID_VALUE", textDocument({ characterRanges: [{ start: 4, end: 2, fontSize: 10 }] })],
    ["INVALID_VALUE", textDocument({ characterRanges: [{ start: 0, end: 2, justification: "CENTER_JUSTIFY" }] })],
  ]);
});

test("bounded exact expressions and typed marker mutations are accepted", () => {
  const expression = { type: "set_expression", target: { ...target, propertyPath: "ADBE Transform Group/ADBE Position" }, source: "value + 1", enabled: true } satisfies JsonObject;
  const options = { bounds: { maxOperations: 3, maxExpressionLength: 64 } };
  assertSequences([["ok", [expression, { type: "add_marker", target, time: 1, comment: "Beat", label: 2 }, { type: "remove_marker", target, time: 1, destructive: true }]]], options);
  assertOperations([["INVALID_OPERATION", { ...expression, source: "x".repeat(65) }]], options);
});

test("marker writes need a typed field and a destructive remove needs confirmation", () => {
  assertOperations([
    ["INVALID_OPERATION", { type: "add_marker", target, time: 1 }],
    ["DESTRUCTIVE_CONFIRMATION_REQUIRED", { type: "remove_marker", target, time: 1 }],
    ["ok", { type: "add_marker", target, time: 1, duration: 2 }],
    ["ok", { type: "add_marker", target, time: 1, label: 3 }],
  ]);
});

const plate = { id: "footage-plate", name: "plate.mov", type: "footage", parentFolderId: null, compositionId: null, sourceId: null } satisfies ProjectItemSnapshot;
const itemTarget = { itemId: "footage-plate", ...fingerprints } satisfies JsonObject;
const footageSnapshot: ProjectSnapshot = { ...representativeSnapshot, items: [plate] };

test("footage replacement and proxy paths are accepted for an exact footage item", () => {
  const operations = [{ type: "replace_footage", target: itemTarget, path: "/fixtures/replacement.mov" }, { type: "set_footage_proxy", target: itemTarget, path: "/fixtures/proxy.mov" }, { type: "clear_footage_proxy", target: itemTarget }];
  assertSequences([["ok", operations]], { snapshot: footageSnapshot });
});

test("footage replacement refuses a relative path and a proxy clear refuses a non-footage item", () => {
  assertOperations([["INVALID_VALUE", { type: "replace_footage", target: itemTarget, path: "relative.mov" }]], { snapshot: footageSnapshot });
  assertOperations([["INVALID_TARGET", { type: "clear_footage_proxy", target: itemTarget }]], { snapshot: { ...footageSnapshot, items: [{ ...plate, type: "folder" }] } });
});

test("a render with an explicit output policy is gated behind RENDER_NOW", () => {
  const render = { type: "render_composition", compositionId: compositionTarget.compositionId, ...fingerprints, outputPath: "/renders/title.mov", destinationPolicy: "explicit-local-path" } satisfies JsonObject;
  assertOperations([
    ["ok", { ...render, executeAuthorization: "RENDER_NOW" }],
    ["INVALID_VALUE", { ...render, outputPath: "relative.mov" }],
    ["INVALID_VALUE", { ...render, executeAuthorization: "render" }],
  ]);
});
