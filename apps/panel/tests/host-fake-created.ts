/** Property trees for the layers the fake composition creates and for the camera and light layers the harness starts with. */

import { FakeProperty } from "./host-fake-property.js";

const CAMERA_POSITION_Z = -2666.67;
const LIGHT_POSITION_Z = -1333.33;

/** The Camera Options group a new camera layer carries. */
export function createdCameraOptions(): FakeProperty {
  return new FakeProperty("ADBE Camera Options Group", "Camera Options", [
    new FakeProperty("ADBE Camera Zoom", "Zoom", [], 1000, true),
    new FakeProperty("ADBE Camera Depth of Field", "Depth of Field", [], false, true),
    new FakeProperty("ADBE Camera Focus Distance", "Focus Distance", [], 1000, true),
    new FakeProperty("ADBE Camera Aperture", "Aperture", [], 100, true),
    new FakeProperty("ADBE Camera Blur Level", "Blur Level", [], 100, true),
  ], null, false);
}

/**
 * The Transform group of a new camera or light. Real After Effects 26 (probed): addCamera([x, y]) puts Position at
 * (0, 0, -2666.67) and the Point of Interest at (x, y, 0); addLight puts Position at (0, 0, -1333.33) likewise.
 */
export function createdTransform(point: readonly number[], positionZ = CAMERA_POSITION_Z): FakeProperty {
  const position = new FakeProperty("ADBE Position", "Position", [], [0, 0, positionZ], true);
  position.isSpatial = true;
  const pointOfInterest = new FakeProperty("ADBE Anchor Point", "Point of Interest", [], [point[0] ?? 0, point[1] ?? 0, 0], true);
  return new FakeProperty("ADBE Transform Group", "Transform", [position, pointOfInterest], null, false);
}

/** The Transform group of a new light. */
export function createdLightTransform(point: readonly number[]): FakeProperty {
  return createdTransform(point, LIGHT_POSITION_Z);
}

/** The Light Options group a new light layer carries. */
export function createdLightOptions(): FakeProperty {
  return new FakeProperty("ADBE Light Options Group", "Light Options", [
    new FakeProperty("ADBE Light Intensity", "Intensity", [], 100, true),
    new FakeProperty("ADBE Light Color", "Color", [], [1, 1, 1], true),
    new FakeProperty("ADBE Light Cone Angle", "Cone Angle", [], 90, true),
    new FakeProperty("ADBE Light Cone Feather 2", "Cone Feather", [], 50, true),
  ], null, false);
}

/** The Text group of a new text layer holding `text`. */
export function createdTextProperties(text: string): FakeProperty {
  const sourceText = new FakeProperty("ADBE Text Document", "Source Text", [], { text, justification: 7413 }, true);
  return new FakeProperty("ADBE Text Properties", "Text", [sourceText], null, false);
}
