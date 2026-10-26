// Tests for the svg scene behaviour of the MCP server.
import assert from "node:assert/strict";
import test from "node:test";
import type { ShapePath, VectorShape } from "@extynt/action-plan";
import { representativeSnapshot } from "@extynt/project-graph";
import { callTool, companionSolidPlaceholder, compileSvgScene, designPlaceholder, sceneLayerOperations, sceneManifest, type CompiledScene, type CompiledSceneLayer } from "../src/index.js";
import type { JsonObject } from "@extynt/decode";
import { objectAt, stringAt } from "../src/json.js";
import { parsePathData } from "../src/svg-scene/path.js";

const ROCKET_SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1620 1350">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070b1c"/><stop offset="1" stop-color="#3a2440"/></linearGradient>
    <radialGradient id="planetShade" cx="0.35" cy="0.35" r="0.65"><stop offset="0" stop-color="#5b7bd5"/><stop offset="1" stop-color="#1b2550"/></radialGradient>
    <style>.ring { fill: none; stroke: #e8c170; stroke-width: 14; stroke-linecap: round; }</style>
  </defs>
  <g id="Sky"><rect width="1620" height="1350" fill="url(#sky)"/></g>
  <g id="Ring Back"><path class="ring" d="M 330 880 A 270 70 0 0 1 870 880"/></g>
  <g id="Planet"><circle cx="600" cy="880" r="170" fill="url(#planetShade)"/></g>
  <g id="Ring Front"><path class="ring" d="M 330 880 A 270 70 0 0 0 870 880"/></g>
  <g id="Rocket" data-anchor="bottom-center" transform="translate(1100 400) rotate(20)">
    <path id="Body" d="M0 -120 C 40 -80 40 40 30 80 L -30 80 C -40 40 -40 -80 0 -120 Z" fill="#f2f2f2"/>
    <path id="Window" fill-rule="evenodd" fill="#c0392b" d="M -20 -20 a 20 20 0 1 0 40 0 a 20 20 0 1 0 -40 0 Z M -10 -20 a 10 10 0 1 0 20 0 a 10 10 0 1 0 -20 0 Z"/>
    <polygon points="-30,40 -60,100 -30,80" style="fill:#c0392b;stroke:none"/>
    <text x="0" y="0">NASA</text>
  </g>
</svg>`;

function defined<T>(value: T | undefined | null): T {
  assert.ok(value !== undefined && value !== null, "the value is present");
  return value;
}

function layerIdOf(operation: JsonObject): string | undefined {
  return stringAt(objectAt(operation, "target"), "layerId");
}

function compiled(svg: string, width?: number, height?: number): CompiledScene {
  const result = compileSvgScene(svg, width && height ? { width, height } : {});
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.scene;
}

function layer(scene: CompiledScene, name: string): CompiledSceneLayer {
  const found = scene.layers.find((entry) => entry.name === name);
  assert.ok(found, `layer ${name} was compiled; got ${scene.layers.map((entry) => entry.name).join(", ")}`);
  return found;
}

function close(actual: readonly number[], expected: readonly number[], tolerance = 0.02): void {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - defined(expected[index])) <= tolerance, `${JSON.stringify(actual)} ≈ ${JSON.stringify(expected)}`));
}

test("each top-level group becomes one layer, bottom to top, so occlusion is the drawing's own order", () => {
  const scene = compiled(ROCKET_SCENE, 1620, 1350);
  assert.deepEqual(scene.layers.map((entry) => entry.name), ["Sky", "Ring Back", "Planet", "Ring Front", "Rocket"]);
  assert.deepEqual([scene.width, scene.height], [1620, 1350]);
});

test("a layer is placed on its own centre and its paths are drawn around that anchor", () => {
  const planet = layer(compiled(ROCKET_SCENE, 1620, 1350), "Planet");
  close(planet.anchor, [600, 880]);
  close(planet.bounds, [430, 710, 340, 340]);
  const disc = defined(defined(planet.shapes[0]).paths[0]);
  assert.equal(disc.closed, true);
  assert.equal(disc.vertices.length, 4, "a circle is four cubic segments");
  close(disc.vertices.flat(), [170, 0, 0, 170, -170, 0, 0, -170]);
  close(defined(disc.outTangents).flat(), [0, 93.89, -93.89, 0, 0, -93.89, 93.89, 0]);
  close(defined(disc.inTangents).flat(), [0, -93.89, 93.89, 0, 0, 93.89, -93.89, 0]);
});

test("a gradient that alone fills a layer becomes a Gradient Ramp in that layer's space", () => {
  const scene = compiled(ROCKET_SCENE, 1620, 1350);
  const sky = layer(scene, "Sky");
  close(sky.anchor, [810, 675]);
  assert.deepEqual(sky.ramp && { kind: sky.ramp.kind, start: sky.ramp.start, end: sky.ramp.end }, { kind: "linear", start: [-810, -675], end: [-810, 675] });
  close(defined(sky.ramp).startColor, [7 / 255, 11 / 255, 28 / 255], 0.001);
  const planet = layer(scene, "Planet");
  assert.equal(planet.ramp?.kind, "radial");
  close(planet.ramp.start, [-51, -51]);
  close(planet.ramp.end, [170, -51]);
});

test("stroked rings keep their stroke, cap and openness, and paint nothing else", () => {
  const ring = layer(compiled(ROCKET_SCENE, 1620, 1350), "Ring Back");
  const shape = defined(ring.shapes[0]);
  assert.equal(shape.fill, undefined);
  assert.deepEqual({ ...shape.stroke, color: undefined }, { color: undefined, width: 14, cap: "round" });
  close(defined(shape.stroke).color, [232 / 255, 193 / 255, 112 / 255], 0.001);
  assert.equal(defined(shape.paths[0]).closed, false);
  assert.equal(defined(shape.paths[0]).vertices.length, 3, "a half ellipse is two quarter arcs");
});

test("a transformed group keeps its geometry, pivots where data-anchor says, and draws compound paths with their fill rule", () => {
  const scene = compiled(ROCKET_SCENE, 1620, 1350);
  const rocket = layer(scene, "Rocket");
  assert.deepEqual(rocket.shapes.map((shape) => shape.name), ["Body", "Window", "polygon 3"]);
  close([rocket.anchor[1]], [rocket.bounds[1] + rocket.bounds[3]], 0.02);
  const window = defined(rocket.shapes[1]);
  assert.equal(window.paths.length, 2, "the window's hole stays a second subpath");
  assert.equal(window.fill?.rule, "evenodd");
  assert.equal(rocket.rotation, 20);
  assert.equal(rocket.scale, undefined);
  const nose = defined(defined(defined(rocket.shapes[0]).paths[0]).vertices[0]);
  close([nose[0] + rocket.anchor[0], nose[1] + rocket.anchor[1]], [1100, 400 - 120], 0.05);
  const radians = 20 * Math.PI / 180;
  const position = rocket.position ?? rocket.anchor;
  close([position[0] + nose[0] * Math.cos(radians) - nose[1] * Math.sin(radians), position[1] + nose[0] * Math.sin(radians) + nose[1] * Math.cos(radians)], [1100 + 120 * Math.sin(radians), 400 - 120 * Math.cos(radians)], 0.05);
  assert.ok(scene.warnings.some((warning) => /text is not drawn/i.test(warning)));
});

test("a viewBox is scaled into the composition it is built in", () => {
  const scene = compiled('<svg viewBox="0 0 100 100"><g id="Dot"><circle cx="50" cy="50" r="10" fill="red"/></g></svg>', 1000, 1000);
  const dot = layer(scene, "Dot");
  close(dot.anchor, [500, 500]);
  close(defined(defined(defined(dot.shapes[0]).paths[0]).vertices[0]), [100, 0]);
});

test("one unnamed wrapper around the whole drawing is looked through, and <use> copies are drawn", () => {
  const scene = compiled(`<svg viewBox="0 0 200 200"><defs><circle id="star" r="4" fill="#fff"/></defs>
    <g><g id="Stars"><use href="#star" x="10" y="10"/><use xlink:href="#star" x="50" y="20"/></g><g id="Moon"><circle cx="150" cy="150" r="30" fill="#ddd"/></g></g></svg>`, 200, 200);
  assert.deepEqual(scene.layers.map((entry) => entry.name), ["Stars", "Moon"]);
  assert.equal(layer(scene, "Stars").shapes.length, 2);
});

test("hidden parts, invisible paint and a layer's own opacity are handled like a browser would", () => {
  const scene = compiled(`<svg viewBox="0 0 100 100">
    <g id="Glow" opacity="0.5"><circle cx="50" cy="50" r="40" fill="#ff0" fill-opacity="0.5"/><circle cx="10" cy="10" r="5" fill="none"/><circle cx="90" cy="90" r="5" fill="#fff" display="none"/></g>
    <g id="Gone" style="display:none"><rect width="10" height="10" fill="red"/></g></svg>`, 100, 100);
  assert.deepEqual(scene.layers.map((entry) => entry.name), ["Glow"]);
  const glow = layer(scene, "Glow");
  assert.equal(glow.opacity, 50);
  assert.equal(glow.shapes.length, 1);
  assert.equal(defined(glow.shapes[0]).fill?.opacity, 50);
});

test("a layer that mixes a gradient with other paint flattens it and says why", () => {
  const scene = compiled(`<svg viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>
    <g id="Mixed"><rect width="50" height="50" fill="url(#g)"/><rect x="50" width="50" height="50" fill="#f00"/></g></svg>`, 100, 100);
  const mixed = layer(scene, "Mixed");
  assert.equal(mixed.ramp, undefined);
  close(defined(defined(mixed.shapes[0]).fill).color, [0.5, 0.5, 0.5], 0.01);
  assert.ok(scene.warnings.some((warning) => warning.includes("\"Mixed\" mixes a gradient")));
});

test("broken and empty drawings are refused with the reason, not guessed at", () => {
  const broken = compileSvgScene('<svg viewBox="0 0 10 10"><g id="A"><rect width="5" height="5" fill="red"></g></svg>');
  assert.equal(broken.ok, false);
  assert.equal(!broken.ok && broken.code, "SVG_INVALID");
  const empty = compileSvgScene('<svg viewBox="0 0 10 10"><g id="A"><rect width="5" height="5" fill="none"/></g></svg>');
  assert.equal(!empty.ok && empty.code, "SVG_EMPTY");
  const entity = compileSvgScene('<!DOCTYPE svg [<!ENTITY x "y">]><svg><rect width="5" height="5"/></svg>');
  assert.equal(!entity.ok && entity.code, "SVG_UNSAFE");
});

test("path data: relative commands, smooth-curve reflection, and Z folding the closing point", () => {
  const [path] = parsePathData("m10 10 c 10 0 20 10 20 20 s 10 20 20 20 l -40 0 z");
  assert.ok(path);
  assert.equal(path.closed, true);
  assert.deepEqual(path.vertices, [[10, 10], [30, 30], [50, 50], [10, 50]]);
  assert.deepEqual(path.outTangents[1], [0, 10], "S reflects the previous control point about the current point");
  const square = defined(parsePathData("M0 0 H10 V10 H0 Z")[0]);
  assert.equal(square.vertices.length, 4, "the Z back to the start adds no duplicate vertex");
});

test("a gradient layer builds as shape (create, draw, position, opacity) plus a companion solid with ramp, matte and parent", () => {
  const scene = compiled(ROCKET_SCENE, 1620, 1350);
  const sky = sceneLayerOperations(layer(scene, "Sky"), designPlaceholder("Sky", 0), { compositionId: "comp-1", center: [810, 675], size: [1620, 1350] }, companionSolidPlaceholder("Sky", 0));
  const skyTypes = sky.map((operation) => operation.type);
  assert.deepEqual(skyTypes, ["create_layer", "draw_vector_shapes", "create_layer", "reorder_layer", "ensure_effect", "set_effect_control", "set_effect_control", "set_effect_control", "set_effect_control", "set_track_matte", "set_layer_parent"], "Sky places the matte immediately above its gradient solid");
  assert.deepEqual(defined(sky[2]).size, [1620, 1350], "the companion solid covers the composition");
  assert.deepEqual(sky[3], { type: "reorder_layer", target: defined(sky[0]).target, placement: "before", referenceLayerId: layerIdOf(defined(sky[2])) });
  const planet = sceneLayerOperations(layer(scene, "Planet"), designPlaceholder("Planet", 2), { compositionId: "comp-1", center: [810, 675], size: [1620, 1350] }, companionSolidPlaceholder("Planet", 2));
  const planetTypes = planet.map((operation) => operation.type);
  assert.deepEqual(planetTypes, ["create_layer", "draw_vector_shapes", "set_layer_property", "create_layer", "reorder_layer", "ensure_effect", "set_effect_control", "set_effect_control", "set_effect_control", "set_effect_control", "set_effect_control", "set_track_matte", "set_layer_parent"], "Planet position set then solid created and moved beneath its matte");
  assert.deepEqual(defined(planet[2]).value, [600, 880, 0], "shape layer positioned with the host-stored zero z component");
  assert.deepEqual(defined(planet[6]).value, [549, 829], "the ramp start is converted to composition pixels");
  assert.deepEqual(defined(planet[8]).value, [770, 829], "the ramp end is converted to composition pixels");
  assert.equal(defined(planet[10]).value, 2, "solid ramp shape set to radial");
  const shapeLayerId = layerIdOf(defined(planet[0]));
  const solidLayerId = layerIdOf(defined(planet[3]));
  assert.equal(shapeLayerId, "__new__:design-3-planet");
  assert.equal(solidLayerId, "__new__:design-3-planet-gradient");
  assert.deepEqual(planet[4], { type: "reorder_layer", target: defined(planet[0]).target, placement: "before", referenceLayerId: solidLayerId });
  assert.equal(layerIdOf(defined(planet[11])), solidLayerId);
  assert.equal(defined(planet[11]).matteLayerId, shapeLayerId, "solid matted through shape");
  assert.equal(layerIdOf(defined(planet[12])), solidLayerId);
  assert.equal(defined(planet[12]).parentLayerId, shapeLayerId, "solid parented to shape");
});

test("gradient opacity is applied to the matte only, so the solid is not faded twice", () => {
  const scene = compiled('<svg viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><g id="Fade" opacity="0.5"><rect width="100" height="100" fill="url(#g)"/></g></svg>', 100, 100);
  const operations = sceneLayerOperations(layer(scene, "Fade"), designPlaceholder("Fade", 0), { compositionId: "comp-1", center: [50, 50], size: [100, 100] });
  const opacity = operations.filter((operation) => operation.type === "set_layer_property");
  assert.equal(opacity.length, 1);
  assert.equal(layerIdOf(defined(opacity[0])), designPlaceholder("Fade", 0));
  assert.equal(operations.some((operation) => operation.type === "set_layer_property" && layerIdOf(operation) === companionSolidPlaceholder("Fade", 0)), false);
});

test("every compiled layer including gradient layers is accepted by the plan contract as one proposal", () => {
  const composition = defined(representativeSnapshot.compositions.find((entry) => entry.id === "comp-main"));
  const scene = compiled(ROCKET_SCENE, composition.width, composition.height);
  const operations = scene.layers.flatMap((entry) => {
    const index = scene.layers.indexOf(entry);
    return sceneLayerOperations(entry, designPlaceholder(entry.name, index), { compositionId: "comp-main", center: [composition.width / 2, composition.height / 2], size: [composition.width, composition.height] }, entry.ramp ? companionSolidPlaceholder(entry.name, index) : undefined);
  });
  const proposed = callTool("ae_propose_plan", { summary: "Build the design", operations }, { snapshot: representativeSnapshot, plans: new Map() });
  assert.equal(proposed.ok, true, proposed.ok ? "" : JSON.stringify(proposed.error));
  const drawn = operations.filter((operation) => operation.type === "draw_vector_shapes").length;
  assert.equal(drawn, 5, "All layers including Sky and Planet have draw_vector_shapes");
});

test("the manifest names every layer with its position, bounds, palette, and companion name for gradient layers", () => {
  const manifest = sceneManifest(compiled(ROCKET_SCENE, 1620, 1350));
  assert.equal(manifest.order, "bottom-to-top");
  const planet = defined(manifest.layers.find((entry) => entry.name === "Planet"));
  assert.deepEqual(planet.position, [600, 880]);
  assert.equal(planet.gradient, "radial #5b7bd5→#1b2550");
  assert.equal(planet.companion, "Planet Gradient");
  const sky = defined(manifest.layers.find((entry) => entry.name === "Sky"));
  assert.equal(sky.companion, "Sky Gradient");
  assert.deepEqual(defined(manifest.layers.find((entry) => entry.name === "Ring Front")).colors, ["#e8c170"]);
  assert.equal(defined(manifest.layers.find((entry) => entry.name === "Ring Front")).companion, undefined);
});

test("a compiled shape is exactly the typed draw_vector_shapes payload", () => {
  const shapes: VectorShape[] = layer(compiled(ROCKET_SCENE, 1620, 1350), "Rocket").shapes;
  const paths: ShapePath[] = shapes.flatMap((shape) => shape.paths);
  assert.ok(paths.every((path) => path.vertices.every((vertex) => vertex.every((value) => Number.isFinite(value) && Math.round(value * 100) === value * 100 || Math.abs(Math.round(value * 100) - value * 100) < 1e-6))), "coordinates are rounded to hundredths");
});

function screenVertices(entry: CompiledSceneLayer): number[][] {
  const position = entry.position ?? entry.anchor, radians = (entry.rotation ?? 0) * Math.PI / 180, scale = (entry.scale ?? 100) / 100;
  return entry.shapes.flatMap((shape) => shape.paths.flatMap((path) => path.vertices.map((v) => [
    position[0] + scale * (Math.cos(radians) * v[0] - Math.sin(radians) * v[1]),
    position[1] + scale * (Math.sin(radians) * v[0] + Math.cos(radians) * v[1]),
  ])));
}

const ROCKET_ART = '<path d="M40 0 L-20 -15 L-10 0 L-20 15 Z" fill="#eee"/><path d="M-12 0 L-30 6 L-30 -6 Z" fill="#f80"/>';
const wrap = (transform: string, extra = ""): string => `<svg viewBox="0 0 800 600"><g id="Rocket"${extra} transform="${transform}">${ROCKET_ART}</g></svg>`;

test("a layer group's translate and rotate become Position and Rotation, with the art unrotated in its own frame", () => {
  const rocket = layer(compiled(wrap("translate(384,377) rotate(125)"), 800, 600), "Rocket");
  assert.equal(rocket.rotation, 125);
  assert.equal(rocket.scale, undefined);
  close(rocket.position ?? rocket.anchor, [384, 377]);
  const nose = defined(defined(defined(rocket.shapes[0]).paths[0]).vertices[0]);
  close([nose[0] + rocket.anchor[0] - 384, nose[1] + rocket.anchor[1] - 377], [40, 0], 0.01);
  const reference = layer(compiled(wrap("translate(384,377) rotate(125) skewX(0.001)"), 800, 600), "Rocket");
  assert.equal(reference.rotation, undefined, "the skewed reference is baked");
  const mine = screenVertices(rocket), theirs = screenVertices(reference);
  assert.equal(mine.length, theirs.length);
  mine.forEach((vertex, index) => close(vertex, defined(theirs[index]), 0.05));
});

test("lifted layers are pixel-equivalent to baked ones for rotate about a point, uniform scale, and a custom data-anchor", () => {
  const cases: Array<[string, string]> = [
    ["translate(100 50) rotate(30 20 10)", ""],
    ["translate(300,200) rotate(-70) scale(2)", ""],
    ["translate(300,200) rotate(-70) scale(2)", ' data-anchor="bottom-center"'],
    ["translate(300,200) rotate(-70) scale(2)", ' data-anchor="320 180"'],
    ["scale(0.5) translate(10 10)", ""],
  ];
  for (const [transform, extra] of cases) {
    const lifted = layer(compiled(wrap(transform, extra), 800, 600), "Rocket");
    const reference = layer(compiled(wrap(`${transform} skewX(0.001)`, extra), 800, 600), "Rocket");
    assert.ok(lifted.rotation !== undefined || lifted.scale !== undefined, `${transform} was lifted`);
    assert.ok(reference.rotation === undefined && reference.scale === undefined, `${transform} reference is baked`);
    const mine = screenVertices(lifted), theirs = screenVertices(reference);
    assert.equal(mine.length, theirs.length);
    mine.forEach((vertex, index) => close(vertex, defined(theirs[index]), 0.1));
  }
  const scaled = layer(compiled(wrap("translate(300,200) rotate(-70) scale(2)"), 800, 600), "Rocket");
  assert.equal(scaled.scale, 200);
  assert.equal(scaled.rotation, -70);
  const pivoted = layer(compiled(wrap("translate(300,200) rotate(-70) scale(2)", ' data-anchor="320 180"'), 800, 600), "Rocket");
  close(pivoted.position ?? pivoted.anchor, [320, 180], 0.01);
});

test("a viewBox mapping scales the lifted layer's origin but not its rotation", () => {
  const rocket = layer(compiled(wrap("translate(100,100) rotate(90)"), 1600, 1200), "Rocket");
  assert.equal(rocket.rotation, 90);
  assert.equal(rocket.scale, undefined);
  close(rocket.position ?? rocket.anchor, [200, 200]);
  const nose = defined(defined(defined(rocket.shapes[0]).paths[0]).vertices[0]);
  close([nose[0] + rocket.anchor[0], nose[1] + rocket.anchor[1]], [280, 200], 0.01);
});

test("skew, non-uniform scale and mirroring stay baked into the vertices, and translate-only layers are unchanged", () => {
  for (const transform of ["translate(300,200) skewX(20)", "translate(300,200) scale(2,1)", "translate(300,200) scale(-1,1)", "translate(300,200) rotate(40) scale(1,-1)"]) {
    const rocket = layer(compiled(wrap(transform), 800, 600), "Rocket");
    assert.equal(rocket.rotation, undefined, transform);
    assert.equal(rocket.scale, undefined, transform);
    assert.equal(rocket.position, undefined, transform);
  }
  const plain = layer(compiled(wrap("translate(300,200)"), 800, 600), "Rocket");
  assert.equal(plain.rotation, undefined);
  close(plain.anchor, [300 + 5, 200]);
});

test("rotation and scale reach the build as set_layer_property operations and the manifest", () => {
  const scene = compiled(wrap("translate(384,377) rotate(125) scale(1.5)"), 800, 600);
  const operations = sceneLayerOperations(layer(scene, "Rocket"), designPlaceholder("Rocket", 0), { compositionId: "comp-1", center: [400, 300], size: [800, 600] });
  const rotation = operations.find((operation) => operation.role === "transform.rotation");
  const scale = operations.find((operation) => operation.role === "transform.scale");
  assert.deepEqual(rotation, { type: "set_layer_property", target: defined(operations[0]).target, role: "transform.rotation", propertyPath: "ADBE Transform Group/ADBE Rotate Z", value: 125 });
  assert.deepEqual(scale?.value, [150, 150]);
  assert.equal(scale?.propertyPath, "ADBE Transform Group/ADBE Scale");
  const entry = defined(sceneManifest(scene).layers[0]);
  assert.equal(entry.rotation, 125);
  assert.equal(entry.scale, 150);
  close(entry.position, [384, 377]);
});

test("a layer with a gradient keeps its transform baked", () => {
  const gradient = layer(compiled('<svg viewBox="0 0 800 600"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><g id="Rocket" transform="translate(300,200) rotate(40)"><rect width="100" height="40" fill="url(#g)"/></g></svg>', 800, 600), "Rocket");
  assert.ok(gradient.ramp);
  assert.equal(gradient.rotation, undefined);
});
