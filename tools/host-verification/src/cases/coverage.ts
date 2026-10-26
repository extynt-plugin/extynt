/** Verification cases that cover the remaining operation types. */
import type { Check } from "../types.js";
import { C, EFFECT, L, OUT, P, applied, approx, attr, children, fixture, hostOk, hostRejects, layer, type CaseWithMeta } from "./helpers.js";

const BLUR = "ADBE Gaussian Blur 2", FILL = "ADBE Fill", TEXT_PATH = "ADBE Text Properties/ADBE Text Path Options";
const solid = () => fixture(layer("top", "solid", { name: "Top" }));
const stack = () => fixture(layer("top", "solid", { name: "Top", effects: [BLUR, FILL] }));
const keyed = () => fixture(layer("top", "solid", { name: "Top", keyframes: [{ path: P.opacity, times: [0, 1, 2], values: [0, 50, 100] }] }));
const effectNames = (layerName: string): Check => ({ kind: "custom", describe: `${layerName} effect stack reads Fill above Gaussian Blur`, check: (view) => {
  const id = view.layerId({ name: layerName });
  const direct = Object.entries(view.sections.props).filter(([key]) => key.startsWith(`${id}|ADBE Effect Parade/`) && key.split("/").length === 2).map(([key, entry]) => ({ name: key.split("/")[1] ?? "", ix: entry?.ix }));
  if (direct.length !== 2) return `stack read ${JSON.stringify(direct.map((effect) => effect.name))}`;
  if (direct.some((effect) => effect.ix === undefined)) return `no position recorded for the effects (runner snapshot predates the ix field): ${JSON.stringify(direct.map((effect) => effect.name))}`;
  const ordered = [...direct].sort((a, b) => (a.ix ?? 0) - (b.ix ?? 0)).map((effect) => effect.name);
  return ordered[0]?.startsWith(FILL) && ordered[1]?.startsWith(BLUR) ? undefined : `stack read ${JSON.stringify(ordered)}`;
} });

export const COVERAGE_CASES: CaseWithMeta[] = [
  applied({ id: "layer.center-anchor", covers: ["center_anchor"], title: "Center anchor moves the anchor to the layer's middle and compensates Position", fixture: solid(), operations: [
    [{ type: "set_layer_property", target: L("top"), role: "transform.anchor", propertyPath: P.anchor, value: [0, 0] }],
    [{ type: "center_anchor", target: L("top") }],
  ], expect: [approx("top", P.anchor, [160, 90]), approx("top", P.position, [320, 180])], options: { notes: "The solid fills the 320 x 180 comp and starts centred, so moving its anchor from the corner to the middle moves Position by the same amount to keep the pixels where they were." } }),
  applied({ id: "layer.replace-source", covers: ["replace_layer_source"], title: "Replace layer source points the layer at another footage item", fixture: { footage: [{ key: "red", file: "png-red" }, { key: "blue", file: "png-blue" }], layers: [layer("clip", "footage", { source: "red" })] }, operations: [{ type: "replace_layer_source", target: L("clip"), sourceItemId: "@item:blue" }], expect: [
    { kind: "custom", describe: "the layer's source is now the blue footage item", check: (view) => { const clip = view.layer({ name: "clip" }); return clip && clip.source === view.tokens["@item:blue"] ? undefined : `source ${String(clip?.source)}`; } },
  ] }),
  applied({ id: "layer.resize-solid", covers: ["resize_solid"], title: "Resize solid changes the solid's width and height", fixture: solid(), operations: [{ type: "resize_solid", target: L("top"), width: 200, height: 100 }], expect: [attr("top", "width", 200), attr("top", "height", 100)] }),

  applied({ id: "effects.copy", covers: ["copy_effects"], title: "Copy effects puts the source layer's effects on the target", fixture: fixture(layer("src", "solid", { name: "Source", effects: [BLUR, FILL] }), layer("dst", "solid", { name: "Destination" })), operations: [{ type: "copy_effects", target: L("dst"), source: { compositionId: "@comp", layerId: "@layer:src" } }], expect: [
    children("dst", "ADBE Effect Parade", BLUR, 1), children("dst", "ADBE Effect Parade", FILL, 1), children("src", "ADBE Effect Parade", BLUR, 1),
  ], options: { notes: "The catalogue marks this partial: the host reports what it copied and skipped; property values are not compared." } }),
  applied({ id: "effects.remove", covers: ["remove_effect"], title: "Remove effect takes the named effect off the stack", fixture: stack(), operations: [{ type: "remove_effect", target: L("top", { effectPath: EFFECT(BLUR) }), destructive: true }], expect: [children("top", "ADBE Effect Parade", BLUR, 0), children("top", "ADBE Effect Parade", FILL, 1)] }),
  applied({ id: "effects.reorder", covers: ["reorder_effect"], title: "Reorder effect moves an effect to the top of the stack", fixture: stack(), operations: [{ type: "reorder_effect", target: L("top", { effectPath: EFFECT(FILL) }), index: 1 }], expect: [effectNames("Top")], options: { notes: "Reads the stack back from the layer's own effect group; Fill started below Gaussian Blur." } }),

  applied({ id: "keys.edit.delete", covers: ["edit_keyframes"], title: "Delete one keyframe by time and keep the others", fixture: keyed(), operations: [{ type: "edit_keyframes", target: L("top", { propertyPath: P.opacity }), action: "delete", times: [1] }], expect: [{ kind: "keys", layer: "top", path: P.opacity, times: [0, 2], values: [0, 100], tolerance: 0.001 }] }),
  applied({ id: "keys.edit.move", covers: ["edit_keyframes"], title: "Move a keyframe later by an offset", fixture: keyed(), operations: [{ type: "edit_keyframes", target: L("top", { propertyPath: P.opacity }), action: "move", times: [2], offset: 1 }], expect: [{ kind: "keys", layer: "top", path: P.opacity, times: [0, 1, 3], values: [0, 50, 100], tolerance: 0.001 }] }),
  applied({ id: "keys.read", covers: ["read_keyframes"], title: "Read keyframes returns the keys and changes nothing", fixture: keyed(), operations: [{ type: "read_keyframes", target: L("top", { propertyPath: P.opacity }) }], expect: [hostOk(0), { kind: "keys", layer: "top", path: P.opacity, times: [0, 1, 2], values: [0, 50, 100], tolerance: 0.001 }], options: { undo: false, notes: "A read-only plan opens no undo group, so there is nothing to undo; the keys must be exactly the fixture's afterwards." } }),

  applied({ id: "text.path", covers: ["set_text_path"], title: "Set text path attaches the text to its mask and sets the margins", fixture: fixture(layer("title", "text", { name: "Title", text: "On a path", masks: 1 })), operations: [{ type: "set_text_path", target: L("title"), maskIndex: 1, firstMargin: 12, lastMargin: -8 }], expect: [
    approx("title", `${TEXT_PATH}/ADBE Text Path`, 1), approx("title", `${TEXT_PATH}/ADBE Text First Margin`, 12), approx("title", `${TEXT_PATH}/ADBE Text Last Margin`, -8),
  ] }),
  applied({ id: "comp.open", covers: ["open_composition"], title: "Open composition makes the composition the active item", fixture: solid(), operations: [{ type: "open_composition", target: C() }], expect: [hostOk(0)], options: { notes: "The host reads app.project.activeItem back and fails the step unless it names the composition." } }),

  applied({ id: "analysis.warp-stabilizer", covers: ["start_analysis"], title: "Start analysis adds Warp Stabilizer to a video layer", fixture: { footage: [{ key: "clip", file: "video" }], layers: [layer("clip", "footage", { source: "clip", name: "Clip" })] }, operations: [{ type: "start_analysis", target: L("clip"), kind: "warp-stabilizer" }], expect: [hostOk(0), children("clip", "ADBE Effect Parade", "ADBE SubspaceStabilizer", 1)], options: { rerun: false, undo: false, notes: "The analysis keeps running in the background after the step returns, so no rerun and no undo is attempted while it works. The effect's existence is the evidence; whether analysis finished is not (catalogue: partial)." } }),
  applied({ id: "tracker.to-nulls", covers: ["tracker_to_nulls"], title: "Tracker to nulls makes one null per track point of an existing tracker", fixture: fixture(layer("shot", "solid", { name: "Shot", motionTrackers: 1 })), operations: [{ type: "tracker_to_nulls", target: L("shot"), point: "attach-point" }], expect: [hostOk(0), { kind: "layerCount", equals: 2 }], options: { notes: "Analysis cannot be started from a script, so the fixture adds a tracker with one track point by script (it holds no tracked motion). The nulls' follow expression is judged by the host, not by where the null lands. A build that refuses to add the tracker fails the fixture, which the report shows as fixture-failed, not as a pass." } }),
  applied({ id: "puppet.pins", covers: ["set_puppet_pins"], title: "Set puppet pins wraps the layer in a carrier and places the pins", fixture: fixture(layer("target", "solid", { name: "Pinned" })), operations: [{ type: "set_puppet_pins", target: L("target"), pins: [{ x: 80, y: 45 }, { x: 240, y: 135 }] }], expect: [hostOk(0), { kind: "layer", layer: { name: "Pinned puppet" }, field: "name", exists: true }], options: { notes: "Needs the extynt plugin's stream bridge and the Puppet preset files, so it only passes on a host with the extynt plugin installed; without them the host refuses and the case fails, which is the honest answer." } }),

  applied({ id: "frame.export", covers: ["export_frame"], title: "Export frame writes a PNG of the composition", fixture: solid(), operations: [{ type: "export_frame", target: C(), time: 0, outputPath: `${OUT}/frame.png`, overwrite: true, exportAuthorization: "EXPORT_NOW" }], expect: [hostFile()], options: { external: true, undo: false, files: [`${OUT}/frame.png`] } }),
  applied({ id: "preset.save", covers: ["save_layer_preset"], title: "Save layer preset writes the layer's effects as an .ffx", fixture: stack(), operations: [{ type: "save_layer_preset", target: L("top"), outputPath: `${OUT}/layer-effects.ffx`, overwrite: true, exportAuthorization: "EXPORT_NOW" }], expect: [hostFile()], options: { external: true, undo: false, files: [`${OUT}/layer-effects.ffx`] } }),
  applied({ id: "project.save-as", covers: ["save_project"], title: "Save project as writes the project to a new .aep", fixture: { ...solid(), project: "saved" }, operations: [{ type: "save_project", mode: "save_as", path: `${OUT}/save-as.aep`, overwrite: true }], expect: [hostFile()], options: { external: true, undo: false, files: [`${OUT}/save-as.aep`] } }),
  applied({ id: "project.collect", covers: ["collect_project"], title: "Collect project copies footage next to a new project file", fixture: { footage: [{ key: "red", file: "png-red" }], layers: [layer("top", "solid")] }, operations: [{ type: "collect_project", destinationFolder: `${OUT}/collect`, projectName: "collected", exportAuthorization: "EXPORT_NOW" }], expect: [hostFile()], options: { external: true, rerun: false, undo: false, files: [`${OUT}/collect/collected.aep`], notes: "The host refuses to overwrite an existing collected project, so a rerun is not attempted. Footage is copied into (Footage) and relinked, then the project is saved there." } }),

  hostRejects({ id: "project.switch-unsaved-refused", covers: ["switch_project"], title: "Switching project with unsaved changes is refused unless the user agreed to discard them", fixture: solid(), operations: [{ operation: "switch_project", mode: "new", discardUnsaved: false }], code: "PROJECT_UNSAVED_CHANGES", options: { notes: "Refused before anything closes, so the disposable project the runner works in survives; the applying case is project.switch-open, which runs last." } }),
];

/**
 * The only case that applies switch_project, and it must run after every other case (allCases appends it after the effect sweep): the switch closes the
 * project the run built its fixtures in. The plan saves that project into the out folder first, then switches with mode "open" to that very file, so the
 * run continues in a project that holds the same items. Everything the runner touches afterwards is re-read from `app.project` (dumps, cleanup) or is a
 * file (progress.jsonl, current-case.json, live-report.json); it keeps no project object across cases. The host fails the step unless app.project.file
  * names the opened path, and the hostFile check stats the file it reports. No rerun (a second switch would prove nothing new) and no undo (a
  * closed project has no history).
 */
export const SWITCH_LAST_CASES: CaseWithMeta[] = [
  applied({ id: "project.switch-open", covers: ["switch_project"], title: "Switch project opens the .aep this run saved and reads app.project.file back", fixture: solid(), operations: [
    { type: "save_project", mode: "save_as", path: `${OUT}/switch-target.aep`, overwrite: true },
    { type: "switch_project", mode: "open", path: `${OUT}/switch-target.aep`, discardUnsaved: true },
  ], expect: [hostOk(0), hostFile()], options: { external: true, rerun: false, undo: false, files: [`${OUT}/switch-target.aep`], notes: "Runs last: the switch closes the project the run was building cases in, and the run goes on in the reopened copy. The host reads app.project.file back and fails the step unless it equals the requested path; the reported file must exist on disk." } }),
];

function hostFile(): Check { return { kind: "hostFile", minBytes: 1 }; }
