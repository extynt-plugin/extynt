/** The project the apply_plan harness starts with: one composition holding a text layer, a shape layer, a camera and a light. */

import { FakeProperty } from "./host-fake-property.js";
import { FakeEffectParade, FakeMaskParade, FakeShapeRoot, FakeTextAnimators } from "./host-fake-groups.js";
import { FakeLayer, FakeCompItem } from "./host-fake-comp.js";
import { createdCameraOptions, createdLightOptions } from "./host-fake-created.js";

/** The starting composition and the layers tests reach into. */
export interface MainComposition {
  readonly comp: FakeCompItem;
  readonly title: FakeLayer;
  readonly shapeLayer: FakeLayer;
  readonly cameraLayer: FakeLayer;
  readonly lightLayer: FakeLayer;
}

/** A counter handing out 1, 2, 3 for generated ids. */
export class Sequence {
  private next = 1;

  public take(): number {
    return this.next++;
  }
}

function leaf(matchName: string, name: string, value: number | boolean): FakeProperty {
  return new FakeProperty(matchName, name, [], value, true);
}

function titleLayer(): FakeLayer {
  const sourceText = new FakeProperty("ADBE Text Document", "Source Text", [], { text: "Before", font: "ArialMT", fontSize: 48, fillColor: [1, 1, 1], applyFill: true }, true);
  const text = new FakeProperty("ADBE Text Properties", "Text", [sourceText, new FakeTextAnimators()], null, false);
  const position = new FakeProperty("ADBE Position", "Position", [], [0, 0], true);
  const transform = new FakeProperty("ADBE Transform Group", "Transform", [position], null, false);
  return new FakeLayer("layer-title", [text, transform, new FakeEffectParade(), new FakeProperty("ADBE Marker", "Marker", [], null, false)]);
}

function materialOptions(): FakeProperty {
  return new FakeProperty("ADBE Material Options Group", "Material Options", [
    leaf("ADBE Accepts Shadows", "Accepts Shadows", true),
    leaf("ADBE Casts Shadows", "Casts Shadows", true),
    leaf("ADBE Light Transmission", "Light Transmission", 0),
    leaf("ADBE Diffuse Coefficient", "Diffuse", 100),
    leaf("ADBE Specular Coefficient", "Specular Intensity", 50),
    leaf("ADBE Shininess Coefficient", "Specular Shininess", 50),
    leaf("ADBE Metal Coefficient", "Metal", 0),
  ], null, false);
}

function shapeLayer(): FakeLayer {
  const path = new FakeProperty("ADBE Vector Shape", "Path", [], "M 0 0", true);
  const shape = new FakeShapeRoot([new FakeProperty("ADBE Vector Shape - Group", "Shape 1", [path], null, false)]);
  const maskPath = new FakeProperty("ADBE Mask Shape", "Mask Path", [], "M 0 0", true);
  const mask = new FakeMaskParade([new FakeProperty("ADBE Mask Atom", "Mask 1", [maskPath], null, false)]);
  return new FakeLayer("layer-shape", [shape, mask, materialOptions()]);
}

/** A fresh starting composition with its four layers. */
export function buildMainComposition(): MainComposition {
  const title = titleLayer();
  const shape = shapeLayer();
  const cameraLayer = new FakeLayer("layer-camera", [createdCameraOptions()]);
  const lightLayer = new FakeLayer("layer-light", [createdLightOptions()]);
  const comp = new FakeCompItem("comp-main", [title, shape, cameraLayer, lightLayer]);
  return { comp, title, shapeLayer: shape, cameraLayer, lightLayer };
}
