/** Scene designs drawn as SVG, compiled into native After Effects shape layers. */
export { compileSvgScene, SCENE_LIMITS, type CompiledScene, type CompiledSceneLayer, type SceneCompileResult } from "./scene.js";
export { companionSolidPlaceholder, designPlaceholder, sceneLayerOperations, sceneManifest, type SceneBuildTarget, type SceneManifestLayer } from "./operations.js";
export { extractSvg } from "./xml.js";
export { jsonNodes, LAYER_SHAPE_NODES, plannedSceneLayer, SCENE_BATCH_NODE_BUDGET, sceneLayerLimitProblem, splitHeavyLayers, type PlannedSceneLayer } from "./plan.js";
