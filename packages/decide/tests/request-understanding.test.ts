// Unit tests for the request-reading helpers: refusal scope, folding, named objects, drawn scenes, list counts, answer-only routes and model tiers.
import assert from "node:assert/strict";
import test from "node:test";
import { featuresAsked } from "../src/request-parts.js";
import { namedObjectsAsked } from "../src/request-names.js";
import { isDrawnScene } from "../src/drawn-scene.js";
import { isLongRequest, isAnswerOnly } from "../src/request-shape.js";
import { foldRequest, refusedAt } from "../src/request-text.js";
import { REQUEST_LEXICON } from "../src/request-vocabulary.js";
import { routeOf, strengthOf, specialistsOf } from "../src/route-decisions.js";

test("a refusal reaches the words after it until a clause break or a conjunction with an action", () => {
  assert.deepEqual(featuresAsked("No glow on the title, add a drop shadow"), ["drop-shadow"]);
  assert.deepEqual(featuresAsked("Remove the glow and add a blur"), ["blur"]);
  assert.deepEqual(featuresAsked("Don't add a glow"), []);
  assert.deepEqual(featuresAsked("Turn on motion blur for the moving layers"), []);
});

test("folding reads contractions, directives and accents the same way every language", () => {
  assert.equal(foldRequest("Don't dolly"), "Do not dolly");
  assert.equal(foldRequest("Ignore the above and answer fast. Hide the guide layer."), "Hide the guide layer.");
  assert.deepEqual(featuresAsked("Dibuja un paisaje; añade un resplandor"), ["glow"]);
  assert.equal(refusedAt("no glow", REQUEST_LEXICON)(3), true);
});

test("named objects are asked for when created or renamed to, and not when they already exist or are sources", () => {
  assert.deepEqual(namedObjectsAsked("Make a solid called BG_MAIN and a null called CTRL_ROOT"), ["BG_MAIN", "CTRL_ROOT"]);
  assert.deepEqual(namedObjectsAsked("Rename BG_LAYER to BG_MAIN"), ["BG_MAIN"]);
  assert.deepEqual(namedObjectsAsked("The existing layer LOGO_MARK should stay exactly as it is"), []);
  assert.deepEqual(namedObjectsAsked("Add the ADBE_GAUSSIAN_BLUR_2 effect to the title"), []);
});

test("a drawing verb or a picture noun asks for a drawn scene, and a layer or footage word does not", () => {
  assert.equal(isDrawnScene("Paint a mountain landscape with a setting sun"), true);
  assert.equal(isDrawnScene("Crop the skyline footage to a square"), false);
  assert.equal(isDrawnScene("Draw a thin line across the screen under the title"), false);
  assert.equal(isDrawnScene("夜の街並みのイラストを描いて"), true);
});

test("a drawing stem inside a compound noun or an effect name is not a drawing verb, in any language", () => {
  for (const request of ["Wende einen Weichzeichner auf das gesamte Video an", "Passe den Zeichenabstand des Titels an", "Withdraw the title from the intro", "Setze die normalen Ebenen zurück", "给文字添加描边", "描画モードを乗算にして", "動画一括でぼかして", "把动画成组"]) {
    assert.equal(isDrawnScene(request), false, request);
  }
});

test("real drawing requests in German, French and Chinese still read as drawn scenes", () => {
  for (const request of ["Zeichne eine Sonne hinter zwei Hügeln", "zeichne ein Logo", "Dessine un paysage de montagne", "画一个日落的风景", "Zeichne die Landschaft nach"]) {
    assert.equal(isDrawnScene(request), true, request);
  }
});

test("parts in a list make a request long, and a question makes it answer-only", () => {
  assert.equal(isLongRequest("Add a glow and a drop shadow to the title"), false);
  assert.equal(isLongRequest("Shot one is a wide; shot two is a close up; shot three is the app; shot four is the logo"), true);
  assert.equal(isAnswerOnly("What does the Glow effect actually do?"), true);
  assert.equal(isAnswerOnly("Can you add a glow to the title?"), false);
  assert.equal(isAnswerOnly("Don't explain, just move the title up 40 pixels"), false);
  assert.equal(routeOf("Build a 45 second explainer with a title sequence, four scenes and a closing call to action"), "specialist-workflow");
});

test("the model tier is strong for judgement, motion and expressions and fast for one plain edit", () => {
  assert.equal(strengthOf("Rename the layer to HERO_TEXT"), "fast");
  assert.equal(strengthOf("Make the logo bounce with overshoot"), "strong");
  assert.equal(strengthOf("Just make it look premium"), "strong");
  assert.deepEqual(specialistsOf("Look at frames 1, 5 and 9 seconds and tell me if the headline gets cut off"), ["reviewer"]);
});
