// Project-level and file-level operation kinds: saves, switches, presets, switches on layers and compositions, analysis, collection and exports.
import test from "node:test";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { compositionTarget, fingerprints, footageTarget, target } from "./fixtures.js";
import { assertOperations, assertSequences, type OperationRow } from "./plan-builders.js";

type Fields = JsonObject;

function rows(expected: string, ...fields: readonly Fields[]): readonly (readonly [string, Fields])[] {
  return fields.map((entry): readonly [string, Fields] => [expected, entry]);
}

function save(fields: Fields): Fields {
  return { type: "save_project", ...fingerprints, ...fields };
}

test("save_project takes save, save_as with an .aep path, or increment", () => {
  assertOperations([...rows("ok", save({ mode: "save" }), save({ mode: "increment" }), save({ mode: "save_as", path: "/Users/x/work.aep", overwrite: true }))]);
});

test("save_project never takes a path with the other modes", () => {
  assertOperations([...rows("INVALID_VALUE", save({ mode: "save_as" }), save({ mode: "save_as", path: "/Users/x/work.txt" }), save({ mode: "save", path: "/Users/x/work.aep" }), save({ mode: "save", overwrite: true }), save({ mode: "close" }))]);
});

function compSettings(settings: Fields): Fields {
  return { type: "set_composition_settings", target: compositionTarget, settings };
}

function attribute(role: string, value: JsonValue): Fields {
  return { type: "set_layer_attribute", target, role, value };
}

test("composition switches validate their values", () => {
  assertOperations([
    ["ok", compSettings({ frameBlending: true, draft3d: false, resolutionFactor: [2, 2] })],
    ...rows("INVALID_VALUE", compSettings({ resolutionFactor: [0, 2] }), compSettings({ resolutionFactor: [2] }), compSettings({ frameBlending: 1 })),
  ]);
});

test("the auto-orient and preserve-transparency layer switches validate their values", () => {
  assertOperations([
    ["ok", attribute("preserve-transparency", true)],
    ["ok", attribute("auto-orient", "ALONG_PATH")],
    ["INVALID_VALUE", attribute("auto-orient", "SPIRAL")],
    ["INVALID_VALUE", attribute("preserve-transparency", "yes")],
  ]);
});

test("replace_layer_source validates its item", () => {
  assertOperations([
    ["ok", { type: "replace_layer_source", target, sourceItemId: "comp-square" }],
    ["TARGET_NOT_FOUND", { type: "replace_layer_source", target, sourceItemId: "no-such-item" }],
    ["INVALID_VALUE", { type: "replace_layer_source", target, sourceItemId: target.compositionId }],
  ]);
});

test("center_anchor validates its time", () => {
  assertOperations([["ok", { type: "center_anchor", target }], ["ok", { type: "center_anchor", target, time: 2 }], ["INVALID_VALUE", { type: "center_anchor", target, time: -1 }]]);
});

test("copy_effects validates its source and effect paths", () => {
  const source = { compositionId: "comp-main", layerId: "layer-footage" } satisfies JsonObject;
  assertOperations([
    ["ok", { type: "copy_effects", target, source }],
    ["ok", { type: "copy_effects", target, source, effectPaths: ["ADBE Effect Parade/ADBE Gaussian Blur 2"] }],
    ["INVALID_VALUE", { type: "copy_effects", target, source: { compositionId: "comp-main", layerId: target.layerId } }],
    ["TARGET_NOT_FOUND", { type: "copy_effects", target, source: { compositionId: "gone", layerId: "x" } }],
    ["INVALID_VALUE", { type: "copy_effects", target, source, effectPaths: ["ADBE Effect Parade/a/b"] }],
    ["INVALID_OPERATION", { type: "copy_effects", target }],
  ]);
});

function lightOptions(options: Fields): Fields {
  return { type: "set_light_options", target, options };
}

test("light options take falloff and shadow fields", () => {
  assertOperations([
    ["ok", lightOptions({ falloffType: 2, falloffStart: 10, falloffDistance: 500, castsShadows: true, shadowDarkness: 60, shadowDiffusion: 20 })],
    ...rows("INVALID_VALUE", lightOptions({ falloffType: 4 }), lightOptions({ castsShadows: "yes" }), lightOptions({ shadowDarkness: 101 })),
  ]);
});

test("light-type is a layer switch", () => {
  assertOperations([["ok", attribute("light-type", "SPOT")], ["INVALID_VALUE", attribute("light-type", "AREA")]]);
});

test("set_text_path validates its mask index", () => {
  assertOperations([
    ["ok", { type: "set_text_path", target, maskIndex: 1, firstMargin: 10 }],
    ["INVALID_OPERATION", { type: "set_text_path", target }],
    ["INVALID_VALUE", { type: "set_text_path", target, maskIndex: -1 }],
  ]);
});

test("open_composition needs a known composition", () => {
  assertOperations([["ok", { type: "open_composition", target: compositionTarget }], ["TARGET_NOT_FOUND", { type: "open_composition", target: { ...compositionTarget, compositionId: "gone" } }]]);
});

test("start_analysis validates its kind and layer", () => {
  assertOperations([
    ["ok", { type: "start_analysis", target: footageTarget, kind: "warp-stabilizer" }],
    ["ok", { type: "start_analysis", target: footageTarget, kind: "camera-tracker-3d" }],
    ["INVALID_VALUE", { type: "start_analysis", target: footageTarget, kind: "create-camera" }],
    ["INVALID_TARGET", { type: "start_analysis", target, kind: "warp-stabilizer" }],
  ]);
});

function interpretation(values: Fields): readonly JsonObject[] {
  const item = { itemId: "__new__:clip", ...fingerprints } satisfies JsonObject;
  return [{ type: "import_file", newItemId: "__new__:clip", ...fingerprints, path: "/Users/x/clip.mov" }, { type: "set_footage_interpretation", target: item, interpretation: values }];
}

test("footage interpretation takes the alpha, field and pulldown extras", () => {
  assertSequences([
    ["ok", interpretation({ invertAlpha: true, highQualityFieldSeparation: false, removePulldown: "WSSWW" })],
    ["ok", interpretation({ guessAlpha: true })],
    ["ok", interpretation({ guessPulldown: "advance-24p", resetFrameRate: true })],
  ]);
});

test("footage interpretation refuses conflicting pairs", () => {
  assertSequences([
    ["INVALID_VALUE", interpretation({ guessAlpha: true, alphaMode: "straight" })],
    ["INVALID_VALUE", interpretation({ guessPulldown: "pulldown-3-2", removePulldown: "off" })],
    ["INVALID_VALUE", interpretation({ resetFrameRate: true, conformFrameRate: 30 })],
    ["INVALID_VALUE", interpretation({ removePulldown: "XYZ" })],
    ["INVALID_VALUE", interpretation({ guessAlpha: false })],
  ]);
});

test("resize_solid takes a size or a pixel aspect", () => {
  assertOperations([
    ["ok", { type: "resize_solid", target: footageTarget, width: 640, height: 360 }],
    ["ok", { type: "resize_solid", target: footageTarget, pixelAspect: 2, allUsers: true }],
    ["INVALID_OPERATION", { type: "resize_solid", target: footageTarget }],
    ["INVALID_VALUE", { type: "resize_solid", target: footageTarget, width: 0 }],
  ]);
});

test("tracker_to_nulls validates its point", () => {
  assertOperations([
    ["ok", { type: "tracker_to_nulls", target }],
    ["ok", { type: "tracker_to_nulls", target, trackerName: "Tracker 1", point: "feature-center" }],
    ["INVALID_VALUE", { type: "tracker_to_nulls", target, point: "corner" }],
  ]);
});

function collect(fields: Fields): Fields {
  return { type: "collect_project", ...fingerprints, destinationFolder: "/Users/x/job", projectName: "walk", exportAuthorization: "EXPORT_NOW", ...fields };
}

test("collect_project validates its authorization, name and folder", () => {
  assertOperations([
    ["ok", collect({})],
    ["EXPORT_AUTHORIZATION_REQUIRED", collect({ exportAuthorization: "yes" })],
    ["INVALID_VALUE", collect({ projectName: "a/b" })],
    ["INVALID_VALUE", collect({ destinationFolder: "relative/job" })],
  ]);
});

function preset(fields: Fields): Fields {
  return { type: "apply_preset", target, ...fields };
}

const PRESET_ID = "preset:ae-presets:0123456789abcdef0123";

test("apply_preset takes a catalogue presetId or one of extynt's own .ffx files", () => {
  assertOperations([...rows("ok", preset({ presetFile: "presets/Wiggle.ffx" }), preset({ presetFile: "puppet/puppet-grid-4x4-1080.ffx" }), preset({ presetId: PRESET_ID }))]);
});

test("apply_preset never takes both and never a path out of the library", () => {
  assertOperations([...rows("INVALID_VALUE", preset({ presetFile: "presets/Wiggle.ffx", presetId: PRESET_ID }), preset({ presetFile: "../../etc/evil.ffx" }), preset({ presetFile: "/Users/x/evil.ffx" }), preset({ presetFile: "presets/Wiggle.exe" }), preset({}))]);
});

function switchProject(fields: Fields): Fields {
  return { type: "switch_project", ...fingerprints, ...fields };
}

test("switch_project takes new or open and needs the acknowledgement as a boolean", () => {
  const rejected: readonly Fields[] = [switchProject({ mode: "open" }), switchProject({ mode: "open", path: "/Users/x/walk.mov" }), switchProject({ mode: "new", path: "/Users/x/walk.aep" }), switchProject({ mode: "new", discardUnsaved: "yes" }), switchProject({ mode: "close" })];
  assertOperations([...rows("ok", switchProject({ mode: "new" }), switchProject({ mode: "open", path: "/Users/x/walk.aep", discardUnsaved: true })), ...rows("INVALID_VALUE", ...rejected)]);
});

test("switch_project is always the last operation", () => {
  const rowsOf: readonly (readonly [string, readonly JsonObject[]])[] = [
    ["INVALID_VALUE", [switchProject({ mode: "new" }), save({ mode: "save" })]],
    ["ok", [save({ mode: "save" }), switchProject({ mode: "new" })]],
  ];
  assertSequences(rowsOf);
});

function layerPreset(fields: Fields): Fields {
  return { type: "save_layer_preset", target, outputPath: "/Users/x/fx.ffx", exportAuthorization: "EXPORT_NOW", ...fields };
}

test("save_layer_preset needs an .ffx path, optional effect paths and the export authorization", () => {
  assertOperations([
    ["ok", layerPreset({})],
    ["ok", layerPreset({ effectPaths: ["ADBE Effect Parade/ADBE Gaussian Blur 2"], overwrite: true })],
    ["INVALID_VALUE", layerPreset({ outputPath: "/Users/x/fx.txt" })],
    ["INVALID_VALUE", layerPreset({ effectPaths: [] })],
    ["EXPORT_AUTHORIZATION_REQUIRED", layerPreset({ exportAuthorization: "yes" })],
  ]);
});

test("read_keyframes needs a full property path and a sane key limit", () => {
  const pathTarget = { ...target, propertyPath: "ADBE Transform Group/ADBE Position" } satisfies JsonObject;
  assertOperations([
    ["ok", { type: "read_keyframes", target: pathTarget }],
    ["ok", { type: "read_keyframes", target: pathTarget, maxKeys: 500 }],
    ["INVALID_VALUE", { type: "read_keyframes", target: pathTarget, maxKeys: 501 }],
    ["INVALID_TARGET", { type: "read_keyframes", target }],
  ]);
});

function frame(fields: Fields): OperationRow {
  return ["ok", { type: "export_frame", target: compositionTarget, time: 0, outputPath: "/Users/x/Movies/new-folder/still.png", exportAuthorization: "EXPORT_NOW", ...fields }];
}

test("export_frame takes an optional whole-number resolution divisor", () => {
  assertOperations([frame({}), frame({ resolution: 1 }), frame({ resolution: 2 })]);
});

test("export_frame refuses a resolution that is not a whole number", () => {
  const refused = [{ resolution: 0 }, { resolution: 1.5 }, { resolution: "half" }].map((fields): OperationRow => ["INVALID_VALUE", frame(fields)[1]]);
  assertOperations(refused);
});
