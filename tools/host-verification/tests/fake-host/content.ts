/** The property trees the fixture's solid, text and shape layers carry. */
import type { HostValue } from "./gradient.js";
import { FakeProperty } from "./property.js";

function group(matchName: string, children: FakeProperty[]): FakeProperty {
  const property = new FakeProperty(matchName);
  property.propertyType = 3;
  for (const child of children) { child.parent = property; property.children.push(child); }
  return property;
}

function leaf(matchName: string, value: HostValue, valueType = 1): FakeProperty {
  const property = new FakeProperty(matchName);
  property.baseValue = value;
  property.propertyValueType = valueType;
  return property;
}

function transformGroup(anchor: number[], position: number[]): FakeProperty {
  const anchorPoint = leaf("ADBE Anchor Point", anchor, 3); anchorPoint.dimensions = 3; anchorPoint.padValue = 0;
  const positionProperty = leaf("ADBE Position", position, 3); positionProperty.dimensions = 3; positionProperty.padValue = 0;
  const scale = leaf("ADBE Scale", [100, 100, 100], 2); scale.dimensions = 3; scale.padValue = 100;
  return group("ADBE Transform Group", [anchorPoint, positionProperty, scale, leaf("ADBE Rotate Z", 0), leaf("ADBE Opacity", 100)]);
}

export function solidProperties(): FakeProperty {
  return group("ADBE Root", [
    transformGroup([160, 90], [160, 90]),
    new FakeProperty("ADBE Mask Parade"),
    new FakeProperty("ADBE Effect Parade"),
    leaf("ADBE Marker", null, 0),
  ]);
}

export function textProperties(text: string): FakeProperty {
  return group("ADBE Root", [
    transformGroup([0, 0], [160, 90]),
    group("ADBE Text Properties", [leaf("ADBE Text Document", { text }, 4), new FakeProperty("ADBE Text Animators")]),
    new FakeProperty("ADBE Mask Parade"),
    new FakeProperty("ADBE Effect Parade"),
    leaf("ADBE Marker", null, 0),
  ]);
}

export function shapeProperties(): FakeProperty {
  return group("ADBE Root", [
    transformGroup([0, 0], [160, 90]),
    new FakeProperty("ADBE Root Vectors Group"),
    new FakeProperty("ADBE Mask Parade"),
    new FakeProperty("ADBE Effect Parade"),
    leaf("ADBE Marker", null, 0),
  ]);
}
