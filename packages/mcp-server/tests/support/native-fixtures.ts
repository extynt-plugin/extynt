// Proposal fixtures for every implemented native operation: one valid ae_propose_plan input per registry id.
import { validateInlineSvg } from "@extynt/action-plan";
import { MOGRT_OUTPUT, RENDER_OUTPUT } from "./fixtures.js";
import { jsonOf } from "../../src/json.js";
import type { JsonObject } from "@extynt/decode";

/** An ae_propose_plan input: a summary and the operations it proposes. */
export type ProposalFixture = { summary: string; operations: JsonObject[] };

function inlineVectorFixture(): ProposalFixture {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M0 0 L20 0 L10 20 Z" fill="#ff3366"/></svg>';
  const checked = validateInlineSvg(svg);
  if (!checked.ok) throw new Error("inline SVG fixture must validate");
  return { summary: "Vector", operations: [{ type: "create_vector_artwork", newItemId: "__new__:vector", name: "Vector", svg, sourceHash: checked.metadata.sourceHash, metadata: jsonOf(checked.metadata), importMode: "editable", managedSourcePolicy: "retain" }] };
}

interface FixtureRefs { shape: JsonObject; layer: JsonObject; avLayer: JsonObject; property: { compositionId: string; layerId: string; propertyPath: string } }

function projectFixtures({ layer, avLayer }: FixtureRefs): Readonly<Record<string, ProposalFixture>> {
  return {
    "project.create-folder": { summary: "Folder", operations: [{ type: "create_folder", newFolderId: "__new__:folder", name: "Folder" }] },
    "project.move-item": { summary: "Move", operations: [{ type: "move_item_to_folder", target: { itemId: "footage-plate" }, folderId: "folder-root" }] },
    "project.rename-item": { summary: "Rename item", operations: [{ type: "set_item_name", target: { itemId: "footage-plate" }, name: "Plate" }] },
    "project.delete-item": { summary: "Delete item", operations: [{ type: "delete_project_item", target: { itemId: "folder-delete" }, destructive: true }] },
    "vector.create-inline": inlineVectorFixture(),
    "composition.create": { summary: "Comp", operations: [{ type: "create_composition", newCompositionId: "__new__:comp", name: "Comp", width: 1920, height: 1080, durationSeconds: 2, frameRate: 24 }] },
    "composition.duplicate": { summary: "Duplicate comp", operations: [{ type: "duplicate_composition", target: { compositionId: "comp-main" }, newCompositionId: "__new__:copy", name: "Copy" }] },
    "property.edit-keyframes": { summary: "Edit keys", operations: [{ type: "edit_keyframes", target: { compositionId: "comp-main", layerId: "layer-title", propertyPath: "ADBE Transform Group/ADBE Position" }, action: "move", offset: 0.5 }] },
    "project.save": { summary: "Save", operations: [{ type: "save_project", mode: "save" }] },
    "composition.export-frame": { summary: "Export frame", operations: [{ type: "export_frame", target: { compositionId: "comp-main" }, time: 1, outputPath: MOGRT_OUTPUT.replace(/\.mogrt$/, ".png"), exportAuthorization: "EXPORT_NOW" }] },
    "layer.tracker-nulls": { summary: "Tracker nulls", operations: [{ type: "tracker_to_nulls", target: { compositionId: "comp-main", layerId: "layer-footage" } }] },
    "property.read-keyframes": { summary: "Read keys", operations: [{ type: "read_keyframes", target: { compositionId: "comp-main", layerId: "layer-title", propertyPath: "ADBE Transform Group/ADBE Position" } }] },
    "presets.save": { summary: "Save preset", operations: [{ type: "save_layer_preset", target: { compositionId: "comp-main", layerId: "layer-title" }, outputPath: MOGRT_OUTPUT.replace(/\.mogrt$/, ".ffx"), exportAuthorization: "EXPORT_NOW" }] },
    "project.switch": { summary: "New project", operations: [{ type: "switch_project", mode: "new", discardUnsaved: true }] },
    "project.collect": { summary: "Collect", operations: [{ type: "collect_project", destinationFolder: MOGRT_OUTPUT.replace(/\/[^/]*$/, "/collected"), projectName: "walk", exportAuthorization: "EXPORT_NOW" }] },
    "solid.resize": { summary: "Resize solid", operations: [{ type: "resize_solid", target: { compositionId: "comp-main", layerId: "layer-footage" }, width: 640, height: 360 }] },
    "text.path": { summary: "Text path", operations: [{ type: "set_text_path", target: { compositionId: "comp-main", layerId: "layer-title" }, maskIndex: 1, firstMargin: 10 }] },
    "composition.open": { summary: "Open comp", operations: [{ type: "open_composition", target: { compositionId: "comp-main" } }] },
    "analysis.start": { summary: "Stabilize", operations: [{ type: "start_analysis", target: { compositionId: "comp-main", layerId: "layer-footage" }, kind: "warp-stabilizer" }] },
    "layer.replace-source": { summary: "Replace source", operations: [{ type: "replace_layer_source", target: { compositionId: "comp-main", layerId: "layer-footage" }, sourceItemId: "footage-plate" }] },
    "transform.center-anchor": { summary: "Centre anchor", operations: [{ type: "center_anchor", target: { compositionId: "comp-main", layerId: "layer-title" } }] },
    "effects.copy": { summary: "Copy effects", operations: [{ type: "copy_effects", target: { compositionId: "comp-main", layerId: "layer-footage" }, source: { compositionId: "comp-main", layerId: "layer-title" } }] },
    "puppet.set-pins": { summary: "Pins", operations: [{ type: "set_puppet_pins", target: { compositionId: "comp-main", layerId: "layer-footage" }, pins: [{ x: 10, y: 20 }] }] },
    "effects.remove": { summary: "Remove effect", operations: [{ type: "remove_effect", target: { compositionId: "comp-main", layerId: "layer-title", effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" }, destructive: true }] },
    "effects.reorder": { summary: "Reorder effect", operations: [{ type: "reorder_effect", target: { compositionId: "comp-main", layerId: "layer-title", effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" }, index: 1 }] },
    "composition.update-settings": { summary: "Comp settings", operations: [{ type: "set_composition_settings", target: { compositionId: "comp-main" }, settings: { width: 1280 } }] },
    "layer.create": { summary: "Layer", operations: [{ type: "create_layer", target: { compositionId: "comp-main" }, layerType: "text", name: "Text", text: "Hi" }] },
    "layer.duplicate": { summary: "Duplicate", operations: [{ type: "duplicate_layer", target: layer, newLayerId: "__new__:copy" }] },
    "layer.derive": { summary: "Split", operations: [{ type: "derive_layer", target: avLayer, kind: "split", newLayerId: "__new__:half", time: 3 }] },
  };
}

function layerFixtures({ shape, layer, avLayer, property }: FixtureRefs): Readonly<Record<string, ProposalFixture>> {
  return {
    "camera.dolly": { summary: "Push in", operations: [{ type: "create_layer", target: { compositionId: "comp-main" }, layerType: "camera", name: "Camera" }, { type: "dolly_camera", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, keyframes: [{ time: 0, distance: 2667 }, { time: 5, distance: 2200 }] }] },
    "layer.retime": { summary: "Reverse", operations: [{ type: "retime_layer", target: avLayer, mode: "reverse" }] },
    "layer.remove": { summary: "Remove", operations: [{ type: "remove_layer", target: layer, destructive: true }] },
    "layer.reorder": { summary: "Reorder", operations: [{ type: "reorder_layer", target: layer, placement: "end" }] },
    "layer.rename": { summary: "Rename", operations: [{ type: "set_layer_name", target: layer, name: "Renamed" }] },
    "transform.set": { summary: "Transform", operations: [{ type: "set_layer_property", target: property, role: "transform.opacity", propertyPath: property.propertyPath, value: 50 }] },
    "property.animate": { summary: "Animate", operations: [{ type: "animate_property", target: property, role: "transform.opacity", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 100 }] }] },
    "timing.set": { summary: "Timing", operations: [{ type: "set_layer_timing", target: layer, inPoint: 0, outPoint: 2 }] },
    "timing.enable-remap": { summary: "Remap", operations: [{ type: "set_time_remap", target: avLayer, enabled: true }] },
    "parenting.set": { summary: "Parent", operations: [{ type: "set_layer_parent", target: layer, parentLayerId: null }] },
    "track-matte.set": { summary: "Matte", operations: [{ type: "set_track_matte", target: layer, matteLayerId: null, mode: "alpha" }] },
    "text.set-document": { summary: "Text", operations: [{ type: "set_text_document", target: layer, text: "Hello" }] },
    "text.ensure-animator": { summary: "Animator", operations: [{ type: "ensure_text_animator", target: layer, role: "text.opacity", value: 0 }] },
    "text.animate-selector": { summary: "Selector", operations: [{ type: "ensure_text_animator", target: layer, role: "text.opacity", value: 0 }, { type: "animate_property", target: { ...layer, propertyPath: "ADBE Text Properties/ADBE Text Animators/ADBE Text Animator/ADBE Text Selectors/ADBE Text Selector/ADBE Text Percent End" }, keyframes: [{ time: 0, value: 0 }, { time: 1, value: 100 }] }] },
    "mask.create-update": { summary: "Mask", operations: [{ type: "add_mask", target: layer, newMaskId: "__new__:mask", name: "Mask", values: { path: shape } }, { type: "update_mask", target: layer, maskId: "__new__:mask", values: { opacity: 50 } }] },
    "shape.group": { summary: "Shape group", operations: [{ type: "create_layer", target: { compositionId: "comp-main" }, layerType: "shape", name: "Shapes" }, { type: "create_shape_group", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, newGroupId: "__new__:group", name: "Group" }] },
    "shape.path": { summary: "Shape path", operations: [{ type: "create_layer", target: { compositionId: "comp-main" }, layerType: "shape", name: "Shapes" }, { type: "create_shape_group", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, newGroupId: "__new__:group", name: "Group" }, { type: "set_shape_path", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, groupId: "__new__:group", path: shape }] },
    "shape.fill": { summary: "Shape fill", operations: [{ type: "create_layer", target: { compositionId: "comp-main" }, layerType: "shape", name: "Shapes" }, { type: "create_shape_group", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, newGroupId: "__new__:group", name: "Group" }, { type: "ensure_shape_fill", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, groupId: "__new__:group", color: [1, 0, 0] }] },
    "shape.stroke": { summary: "Shape stroke", operations: [{ type: "create_layer", target: { compositionId: "comp-main" }, layerType: "shape", name: "Shapes" }, { type: "create_shape_group", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, newGroupId: "__new__:group", name: "Group" }, { type: "ensure_shape_stroke", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, groupId: "__new__:group", color: [1, 0, 0], width: 2 }] },
    "shape.vector-draw": { summary: "Vector shapes", operations: [{ type: "create_layer", target: { compositionId: "comp-main" }, layerType: "shape", name: "Planet" }, { type: "draw_vector_shapes", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, shapes: [{ name: "Disc", paths: [{ vertices: [[0, -50], [50, 0], [0, 50], [-50, 0]], closed: true }], fill: { color: [0.2, 0.3, 0.8] } }, { name: "Ring", paths: [{ vertices: [[-80, 0], [80, 0]], closed: false }], stroke: { color: [0.9, 0.8, 0.4], width: 6, cap: "round" } }] }] },
    "camera.set-options": { summary: "Camera", operations: [{ type: "create_layer", target: { compositionId: "comp-main" }, layerType: "camera", name: "Camera" }, { type: "set_camera_options", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, options: { zoom: 1000 } }] },
    "light.set-options": { summary: "Light", operations: [{ type: "create_layer", target: { compositionId: "comp-main" }, layerType: "light", name: "Light" }, { type: "set_light_options", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, options: { intensity: 50 } }] },
    "material.set": { summary: "Material", operations: [{ type: "create_layer", target: { compositionId: "comp-main" }, layerType: "shape", name: "Shapes" }, { type: "set_material_options", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, options: { diffuse: 50 } }] },
    "audio.set": { summary: "Audio", operations: [{ type: "set_audio", target: avLayer, enabled: true }] },
    "effects.ensure": { summary: "Effect", operations: [{ type: "ensure_effect", target: { ...layer, effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" }, capabilityId: "adobe.gaussian-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" }] },
    "effects.animate-control": { summary: "Effect animate", operations: [{ type: "ensure_effect", target: { ...layer, effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" }, capabilityId: "adobe.gaussian-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" }, { type: "animate_control", target: { ...layer, effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2", propertyPath: "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001" }, effectMatchName: "ADBE Gaussian Blur 2", role: "blur.amount", keyframes: [{ time: 0, value: 0 }] }] },
  };
}

function hostFixtures({ layer, property }: FixtureRefs): Readonly<Record<string, ProposalFixture>> {
  return {
    "effects.set-control": { summary: "Effect value", operations: [{ type: "ensure_effect", target: { ...layer, effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" }, capabilityId: "adobe.gaussian-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" }, { type: "set_effect_control", target: { ...layer, effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2", propertyPath: "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0002" }, effectMatchName: "ADBE Gaussian Blur 2", value: 2 }] },
    "presets.apply": { summary: "Preset", operations: [{ type: "apply_preset", target: layer, presetId: "preset:ae-presets:0123456789abcdef0123" }] },
    "layer-styles.ensure": { summary: "Style", operations: [{ type: "ensure_layer_style", target: layer, style: "drop-shadow" }] },
    "expressions.set-clear": { summary: "Expression", operations: [{ type: "set_expression", target: { ...layer, propertyPath: "ADBE Transform Group/ADBE Position" }, source: "value", enabled: true }] },
    "markers.add-update-remove": { summary: "Marker", operations: [{ type: "add_marker", target: layer, time: 1, comment: "Beat" }] },
    "footage.import": { summary: "Import", operations: [{ type: "import_file", newItemId: "__new__:item", path: "/fixtures/source.mov" }] },
    "footage.replace": { summary: "Replace", operations: [{ type: "replace_footage", target: { itemId: "footage-plate" }, path: "/fixtures/replacement.mov" }] },
    "footage.proxy": { summary: "Proxy", operations: [{ type: "set_footage_proxy", target: { itemId: "footage-plate" }, path: "/fixtures/proxy.mov" }] },
    "footage.interpretation": { summary: "Interpret", operations: [{ type: "set_footage_interpretation", target: { itemId: "footage-plate" }, interpretation: { alphaMode: "straight", loop: 2 } }] },
    "footage.scene-edit-detection": { summary: "Cuts", operations: [{ type: "detect_scene_edits", target: { compositionId: "comp-main", layerId: "layer-footage" }, mode: "markers" }] },
    "render.add-to-queue": { summary: "Queue", operations: [{ type: "render_composition", compositionId: "comp-main", outputPath: RENDER_OUTPUT, destinationPolicy: "explicit-local-path" }] },
    "render.send-to-media-encoder": { summary: "Media Encoder", operations: [{ type: "render_composition", compositionId: "comp-main", outputPath: RENDER_OUTPUT, destinationPolicy: "explicit-local-path", mediaEncoder: "queue" }] },
    "render.configure": { summary: "Configure render", operations: [{ type: "render_composition", compositionId: "comp-main", renderSettingsTemplate: "Best Settings", outputModuleTemplate: "Lossless", outputPath: RENDER_OUTPUT, destinationPolicy: "explicit-local-path" }] },
    "render.output-settings": { summary: "Output settings", operations: [{ type: "render_composition", compositionId: "comp-main", outputPath: RENDER_OUTPUT, destinationPolicy: "explicit-local-path", outputSettings: { format: "QuickTime", resize: { width: 1280, height: 720 } }, renderSettings: { quality: "Best" } }] },
    "project.cleanup": { summary: "Clean up project", operations: [{ type: "cleanup_project", mode: "remove_unused_footage", destructive: true }] },
    "render.execute": { summary: "Render", operations: [{ type: "render_composition", compositionId: "comp-main", outputPath: RENDER_OUTPUT, destinationPolicy: "explicit-local-path", executeAuthorization: "RENDER_NOW" }] },
    "layer.precompose": { summary: "Precompose", operations: [{ type: "precompose_layers", target: { compositionId: "comp-main" }, layerIds: ["layer-title"], name: "Pre", newCompositionId: "__new__:pre", newLayerId: "__new__:prelayer" }] },
    "layer.add-source": { summary: "Add source", operations: [{ type: "create_layer", target: { compositionId: "comp-main" }, layerType: "solid", name: "BG", color: [0, 0, 0] }] },
    "layer.switches": { summary: "Layer switches", operations: [{ type: "set_layer_attribute", target: layer, role: "motion-blur", value: true }] },
    "text.animator": { summary: "Text animator", operations: [{ type: "add_text_animator", target: layer, newAnimatorId: "__new__:anim", properties: { opacity: 0 }, keyframes: { "selector.start": [{ time: 0, value: 0 }, { time: 1, value: 100 }] } }] },
    "shape.primitive": { summary: "Shape primitive", operations: [{ type: "create_layer", target: { compositionId: "comp-main" }, layerType: "shape", name: "Shapes" }, { type: "create_shape_group", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, newGroupId: "__new__:group", name: "Group" }, { type: "add_shape_item", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, groupId: "__new__:group", item: "rectangle", newItemId: "__new__:rect", values: { size: [100, 50] } }] },
    "shape.gradient": { summary: "Shape gradient", operations: [{ type: "create_layer", target: { compositionId: "comp-main" }, layerType: "shape", name: "Shapes" }, { type: "create_shape_group", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, newGroupId: "__new__:group", name: "Group" }, { type: "add_shape_item", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, groupId: "__new__:group", item: "gradient-fill", newItemId: "__new__:grad", values: { type: 2 } }] },
    "shape.operator": { summary: "Shape operator", operations: [{ type: "create_layer", target: { compositionId: "comp-main" }, layerType: "shape", name: "Shapes" }, { type: "create_shape_group", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, newGroupId: "__new__:group", name: "Group" }, { type: "add_shape_item", target: { compositionId: "comp-main", layerId: "__new__:layer0" }, groupId: "__new__:group", item: "repeater", newItemId: "__new__:rep", values: { copies: 4 } }] },
    "expressions.loop": { summary: "Loop expression", operations: [{ type: "animate_property", target: property, role: "transform.opacity", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 100 }] }, { type: "set_loop", target: property, mode: "cycle" }] },
    "essential-graphics.add-property": { summary: "Add essential property", operations: [{ type: "add_essential_property", target: { ...layer, propertyPath: "ADBE Transform Group/ADBE Position" }, name: "Position" }] },
    "essential-graphics.export-mogrt": { summary: "Export mogrt", operations: [{ type: "export_mogrt", target: { compositionId: "comp-main" }, templateName: "T", outputPath: MOGRT_OUTPUT, exportAuthorization: "EXPORT_NOW" }] },
    "guides-color.guides": { summary: "Set guides", operations: [{ type: "set_composition_guides", target: { compositionId: "comp-main" }, guides: [{ orientation: "vertical", position: 960 }] }] },
    "guides-color.project-settings": { summary: "Project settings", operations: [{ type: "set_project_settings", settings: { bitsPerChannel: 16 } }] },
  };
}

/** The proposal fixture of every implemented native operation, by registry id. */
export function proposalFixtures(): Readonly<Record<string, ProposalFixture>> {
  const shape = { vertices: [[0, 0], [20, 0], [20, 20]], closed: true };
  const layer = { compositionId: "comp-main", layerId: "layer-title" };
  const avLayer = { compositionId: "comp-main", layerId: "layer-footage" };
  const property = { ...layer, propertyPath: "ADBE Transform Group/ADBE Opacity" };
  const refs: FixtureRefs = { shape, layer, avLayer, property };
  return { ...projectFixtures(refs), ...layerFixtures(refs), ...hostFixtures(refs) };
}
