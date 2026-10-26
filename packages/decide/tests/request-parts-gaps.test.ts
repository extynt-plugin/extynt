// Request-parts wording gaps found by paraphrase: a refusal that trails the part, text mattes, camera flights, steadying shaky footage, parenting to a controller and duplicated compositions in several languages.
import assert from "node:assert/strict";
import test from "node:test";
import { featuresAsked, partsConfidence } from "../src/request-parts.js";
import type { FeatureId } from "../src/request-features.js";

const CASES: ReadonlyArray<readonly [request: string, expected: ReadonlyArray<FeatureId>]> = [
  ["Add a blur then take the glow off", ["blur"]],
  ["Add glow, shadow off", ["glow"]],
  ["Put the footage inside the words and add a glow to the edges", ["glow", "matte", "text-matte"]],
  ["Show the picture only where the text is", ["matte", "text-matte"]],
  ["Use the title as a mask so the video plays through the letters", ["matte", "text-matte"]],
  ["Fly the camera past the buildings", ["camera", "camera-move"]],
  ["Pull the camera back to reveal the whole scene", ["camera", "camera-move"]],
  ["Lock the text to the moving object in the shot", ["tracking"]],
  ["Smooth out the shaky shot", ["tracking"]],
  ["Make all the layers follow a single controller layer", ["null", "parent"]],
  ["Make them children of a null", ["null", "parent"]],
  ["Ajoute un halo et un marqueur", ["glow", "markers"]],
  ["Duplica la composición y añade marcadores", ["duplicate-composition", "markers"]],
  ["Dupliziere die Komposition für das Hochformat", ["duplicate-composition"]],
  ["コンポを複製してマーカーを追加", ["duplicate-composition", "markers"]],
  ["ロゴにシャドウとぼかしを追加して", ["blur", "drop-shadow"]],
  ["Stroke the path on over two seconds then fill it in", ["trim-paths"]],
  ["Add a swing to the camera shake", ["camera"]],
  ["Fix the shaky ease on the title", []],
  ["Make the light bounce off the title", []],
  ["Make the layers follow the audio", []],
  ["Pan the background left", []],
];

test("paraphrased and multi-part requests name their features", () => {
  for (const [request, expected] of CASES) assert.deepEqual([...featuresAsked(request)].sort(), [...expected].sort(), request);
});

const REACH: ReadonlyArray<readonly [request: string, expected: ReadonlyArray<FeatureId>]> = [
  ["Create a null and link the three icons to it", ["null", "parent"]],
  ["Add a null object and attach all the layers to it", ["null", "parent"]],
  ["Make a null and hook the text layers up to it so I can move them together", ["null", "parent"]],
  ["Set up a controller null, then tie every shape to that controller", ["null", "parent"]],
  ["Create a null and make each card a child of it", ["null", "parent"]],
  ["Add a null layer and have the logo, tagline and badge follow it", ["null", "parent"]],
  ["New null, then glue the dots onto it", ["null", "parent"]],
  ["Put a null in the comp and connect the five bars to it", ["null", "parent"]],
  ["Add a null and name it Master", ["null"]],
  ["Pin the lower third to the moving sign in the footage", ["tracking"]],
  ["Make the graphic stick onto the billboard as it moves through the shot", ["tracking"]],
  ["Attach the text to the screen on the phone that moves around in the clip", ["tracking"]],
  ["Lock my logo onto the moving billboard", ["tracking"]],
  ["Replace the content on the moving monitor screen in the footage with this image", ["tracking"]],
  ["Put the title on the sign", []],
  ["Make a copy of the comp", ["duplicate-composition"]],
  ["I need another version of the composition for stories", ["duplicate-composition"]],
  ["Give me a square version of this comp", ["duplicate-composition"]],
  ["Make a 1:1 cut of the comp", ["duplicate-composition"]],
  ["Save out a 4:5 cut of this composition for Instagram", ["duplicate-composition"]],
  ["Cut the composition at 3 seconds", []],
  ["Clip the photo to the letters", ["matte", "text-matte"]],
  ["Show the image only inside the type", ["matte", "text-matte"]],
  ["Have the footage visible just within the lettering of the title", ["matte", "text-matte"]],
  ["I want the video to fill the letters of the word SUMMER", ["matte", "text-matte"]],
  ["Mask the photo with the text so it only appears in the glyph shapes", ["matte", "text-matte"]],
  ["Fill the letters with red", []],
  ["Sync the clip to the title", []],
];

test("a null with layers linked to it by pronoun, pinning to a moving sign, aspect-ratio copies and clipping to letters name their features", () => {
  for (const [request, expected] of REACH) assert.deepEqual([...featuresAsked(request)].sort(), [...expected].sort(), request);
});

const LONG_BRIEFS = [
  "Make a 12 second countdown titled LAUNCH. Dark gradient background, a soft glow around each number, a drop shadow under the numbers, blur the numbers as they swap, a camera that pushes in slowly, a null to control the whole stack and parent the numbers to it, markers at every second, a bit of wiggle on the background, a typewriter subtitle, dots that orbit the centre. The thin lines of the ring should write themselves in around each number.",
  "Title sequence for a documentary. Duplicate the comp for a square cut. Use the footage inside the letters of the title, add glow, shadow, blur, gradient ramp, camera push in, null with parenting, markers, wiggle, repeat the stripes. Pin a tag to the moving sign. The strokes of the logo draw on one after another.",
  "Intro: stage 1 background, stage 2 text, stage 3 sparkles, stage 4 a few scribble lines that draw on across the frame, stage 5 outro. Add glow, blur, shadow, ramp, wiggle, markers, camera, null, parent, orbit.",
];

test("a long brief with many features still reports the stroke that draws itself on and the reading stays sure enough to answer", () => {
  for (const request of LONG_BRIEFS) {
    const asked = featuresAsked(request);
    assert.ok(asked.includes("trim-paths"), request);
    assert.ok(partsConfidence(request, asked) >= 0.6, request);
  }
});
