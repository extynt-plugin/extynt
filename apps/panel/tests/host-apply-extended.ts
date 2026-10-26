/** The harness extended with a text layer of animators and a shape layer of repeater, rectangle, fill and stroke groups. */

import { FakeProperty, type FakeValue } from "./host-fake-property.js";
import { FakeAddGroup } from "./host-fake-groups.js";
import { FakeLayer } from "./host-fake-comp.js";
import { loadApplyPlan } from "./host-apply-load.js";

const ANIMATOR_PROPERTY_VALUES: ReadonlyMap<string, FakeValue> = new Map<string, FakeValue>([
  ["ADBE Text Position 3D", [0, 0, 0]],
  ["ADBE Text Opacity", 0],
  ["ADBE Text Fill Color", [1, 1, 1, 1]],
  ["ADBE Text Tracking Amount", 0],
]);

/** A settable leaf property whose name is its match name. */
export function leaf(matchName: string, value: FakeValue = 0): FakeProperty {
  return new FakeProperty(matchName, matchName, [], value, true);
}

function group(matchName: string, name: string, children: FakeProperty[]): FakeProperty {
  return new FakeProperty(matchName, name, children, null, false);
}

function rangeSelector(): FakeProperty {
  const advanced = group("ADBE Text Range Advanced", "Advanced", [leaf("ADBE Text Selector Mode", 1)]);
  return group("ADBE Text Selector", "Range Selector", [leaf("ADBE Text Percent Start", 0), leaf("ADBE Text Percent End", 100), leaf("ADBE Text Percent Offset", 0), advanced]);
}

function expressionSelector(): FakeProperty {
  return group("ADBE Text Expressible Selector", "Expression Selector", [leaf("ADBE Text Range Type2", 1), leaf("ADBE Text Expressible Amount", 100)]);
}

/** A text animator whose groups accept selectors and the common animator properties. */
export function fakeAnimator(): FakeProperty {
  const factories = Object.fromEntries(Array.from(ANIMATOR_PROPERTY_VALUES, ([name, value]) => [name, () => leaf(name, value)]));
  const properties = new FakeAddGroup("ADBE Text Animator Properties", factories);
  const selectors = new FakeAddGroup("ADBE Text Selectors", { "ADBE Text Selector": rangeSelector, "ADBE Text Expressible Selector": expressionSelector });
  return group("ADBE Text Animator", "Animator", [selectors, properties]);
}

function repeater(): FakeProperty {
  const transform = group("ADBE Vector Repeater Transform", "Transform", [leaf("ADBE Vector Repeater Position", [100, 0])]);
  return group("ADBE Vector Filter - Repeater", "Repeater", [leaf("ADBE Vector Repeater Copies", 3), leaf("ADBE Vector Repeater Offset", 0), transform]);
}

function rectangle(): FakeProperty {
  return group("ADBE Vector Shape - Rect", "Rectangle", [leaf("ADBE Vector Rect Size", [100, 100]), leaf("ADBE Vector Rect Roundness", 0)]);
}

function fill(): FakeProperty {
  return group("ADBE Vector Graphic - Fill", "Fill", [leaf("ADBE Vector Fill Color", [1, 1, 1, 1]), leaf("ADBE Vector Fill Opacity", 100)]);
}

function stroke(): FakeProperty {
  return group("ADBE Vector Graphic - Stroke", "Stroke", [leaf("ADBE Vector Stroke Color", [1, 1, 1, 1]), leaf("ADBE Vector Stroke Opacity", 100), leaf("ADBE Vector Stroke Width", 1)]);
}

/** `loadApplyPlan()` plus a text layer `layer-anim` and a shape layer `layer-shapes`, attached to the main composition. */
export function loadExtended() {
  const loaded = loadApplyPlan();
  const animators = new FakeAddGroup("ADBE Text Animators", { "ADBE Text Animator": fakeAnimator });
  const textLayer = new FakeLayer("layer-anim", [group("ADBE Text Properties", "Text", [animators])]);
  const root = new FakeAddGroup("ADBE Root Vectors Group", {
    "ADBE Vector Filter - Repeater": repeater,
    "ADBE Vector Shape - Rect": rectangle,
    "ADBE Vector Graphic - Fill": fill,
    "ADBE Vector Graphic - Stroke": stroke,
  });
  const shapesLayer = new FakeLayer("layer-shapes", [root]);
  for (const layer of [textLayer, shapesLayer]) {
    layer.attach(loaded.comp);
    loaded.comp.layerItems.push(layer);
  }
  return { ...loaded, animators, root, textLayer, shapesLayer };
}
