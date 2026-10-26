// Checks that the request-parts reading finds the features in long, multi-sentence motion briefs in five languages, keeps refusals and existing features out, and does not invent features from stray words.
import assert from "node:assert/strict";
import test from "node:test";
import { featuresAsked, partsConfidence } from "../src/request-parts.js";
import type { FeatureId } from "../src/request-features.js";

function sorted(ids: ReadonlyArray<FeatureId>): ReadonlyArray<FeatureId> {
  return [...ids].sort();
}

function assertAsks(request: string, expected: ReadonlyArray<FeatureId>): void {
  assert.deepEqual(sorted(featuresAsked(request)), sorted(expected), request);
}

test("long brief, en countdown", () => {
  assertAsks(
    "Build a ten second countdown for a sports broadcast. The numbers 3, 2, 1 sit in the middle of a dark circle and each digit should pop in, hold for a beat, then scale away. Wrap a thin ring around them whose outline draws itself on over each second. Behind everything put a soft radial gradient from deep blue to black. Give the digits a subtle glow, but no blur and no shadows please.",
    ["ramp", "trim-paths", "glow"],
  );
});

test("long brief, en rocket", () => {
  assertAsks(
    "A small rocket lifts off from the bottom left of the frame and climbs out of shot. Add a camera that slowly pushes in as it takes off and make the camera shake with a wiggle during ignition. In the top corner there is a planet and a little moon that circles around it forever. Parent the flame to the rocket so they travel together. At the end the word LIFTOFF types on letter by letter.",
    ["camera", "camera-move", "wiggle", "orbit", "parent", "text-animator"],
  );
});

test("long brief, en title", () => {
  assertAsks(
    "Opening title sequence for a documentary. First the studio logo line writes on, revealing the stroke from left to right. Then the title letters pop in one by one with a small offset per character. Put a gradient fill behind the title that goes from teal to purple. Stagger the three subtitle lines by four frames each and keep the background shimmer looping.",
    ["trim-paths", "text-animator", "ramp"],
  );
});

test("long brief, en none", () => {
  assertAsks(
    "Make the whole intro feel more premium and cinematic. The pacing should be calm, with a clear beginning and ending, and the typography should be elegant. Nothing too busy, and keep the colour palette dark.",
    [],
  );
});

test("long brief, en negation", () => {
  assertAsks(
    "Create a clean lower third. Please don't add any glow or drop shadow, and avoid blur. Instead use a plain solid bar and make the name slide in. No gradient anywhere, keep it flat.",
    [],
  );
});

test("long brief, es countdown", () => {
  assertAsks(
    "Crea una cuenta atrás de diez segundos. Los números aparecen uno a uno con un rebote, y un anillo fino se dibuja alrededor de ellos con un trazo que se va trazando cada segundo. El fondo lleva un degradado radial de azul a negro. Sin sombras ni desenfoque, pero con un ligero resplandor en los dígitos.",
    ["ramp", "trim-paths", "glow"],
  );
});

test("long brief, es orbit", () => {
  assertAsks(
    "La luna debe girar alrededor del planeta en una órbita lenta, y una cámara se acerca despacio al planeta. Pon el título animado letra por letra.",
    ["orbit", "camera", "camera-move", "text-animator"],
  );
});

test("long brief, de title", () => {
  assertAsks(
    "Eröffnungstitel für eine Dokumentation: Das Logo zeichnet sich mit einer Linie selbst, die Kontur wird nach und nach aufgedeckt. Danach erscheinen die Buchstaben des Titels einzeln, jeder Buchstabe mit einem kleinen Versatz. Hinter dem Titel liegt ein Farbverlauf von Türkis zu Violett. Kein Schlagschatten und kein Weichzeichner.",
    ["trim-paths", "text-animator", "ramp"],
  );
});

test("long brief, de orbit", () => {
  assertAsks(
    "Der Mond soll auf einer Kreisbahn um den Planeten kreisen. Die Kamera fährt langsam heran und ein leichtes Leuchten umgibt den Planeten.",
    ["orbit", "camera", "camera-move", "glow"],
  );
});

test("long brief, fr title", () => {
  assertAsks(
    "Séquence de titre : le logo se dessine trait par trait, le tracé se révèle de gauche à droite. Ensuite les lettres du titre apparaissent une à une avec un décalage par caractère. Un dégradé de turquoise à violet en arrière-plan. Pas d'ombre portée ni de flou.",
    ["trim-paths", "text-animator", "ramp"],
  );
});

test("long brief, ja title", () => {
  assertAsks(
    "オープニングタイトル：ロゴの線がゆっくり描かれていき、輪郭が左から右へ現れる。その後タイトルの文字が一文字ずつ少しずつずれて現れる。背景は青から紫へのグラデーション。影とぼかしは入れないで。",
    ["trim-paths", "text-animator", "ramp"],
  );
});

test("long brief, ja orbit", () => {
  assertAsks(
    "月が惑星の周りを回る公転のアニメーションにして。カメラはゆっくり寄っていく。",
    ["orbit", "camera", "camera-move"],
  );
});

test("long brief, en context", () => {
  assertAsks(
    "The existing title already has a glow and a gradient behind it, which I like. Leave those alone and just fix the timing so it feels snappier, and rename the layers neatly.",
    [],
  );
});

test("long brief, en typewriter", () => {
  assertAsks(
    "Make the tagline type itself on like a typewriter, one character at a time, and let a blinking cursor follow. Underline it with a line that wipes in. Keep a soft shadow under the text.",
    ["text-animator", "trim-paths", "drop-shadow"],
  );
});

test("long brief, en rocket2", () => {
  assertAsks(
    "Rocket launch scene: the rocket sits on a pad, countdown numbers tick down 5 to 1, then it blasts off. Ember sparks orbit the engine bell. The trail behind the rocket should reveal progressively like a drawn line following its path. A radial ramp from orange to black sits behind the exhaust.",
    ["orbit", "trim-paths", "ramp"],
  );
});

test("long brief, en orbit-noise", () => {
  assertAsks(
    "Rotate the logo in place, spin it slowly like a coin. Please do not make it orbit anything.",
    [],
  );
});

const SHORT_CASES: ReadonlyArray<readonly [string, ReadonlyArray<FeatureId>]> = [
  ["Wrap a ring around the logo and move the whole thing around the screen", []],
  ["Spin the wheel around its center and let the car move around the corner", []],
  ["The planet rotates around its own axis, and the moon revolves around the planet", ["orbit"]],
  ["Draw a house with a roof and a door, in a flat style", []],
  ["Draw a line from the left to the right of the frame", []],
  ["Animate the line so it draws on from left to right", ["trim-paths"]],
  ["The characters walk in one after another and wave", []],
  ["Fade each word in one by one", ["text-animator"]],
  ["Add a color ramp to the background; ramp up the energy at the end", ["ramp"]],
  ["Ramp up the volume toward the finale", []],
  ["No glow, shadow or blur on the title please", []],
  ["Add a glow, no shadow, and blur the background", ["blur", "glow"]],
  ["Don't add a gradient, just a flat colour", []],
  ["Make the logo zoom in at the end", []],
  ["Create a lower third with matte black background", []],
  ["Repeat the animation every two seconds", []],
  ["Soften the easing of the entrance", []],
  ["Soften the background so the title pops", ["blur"]],
  ["Tipo máquina de escribir para el subtítulo y un degradado suave detrás", ["text-animator", "ramp"]],
  ["Le logo se dessine trait par trait puis un dégradé apparaît", ["trim-paths", "ramp"]],
  ["グロー無しで、背景にグラデーションを入れて", ["ramp"]],
  ["文字が一文字ずつ出てくるようにして、カメラはゆっくり引いていく", ["text-animator", "camera", "camera-move"]],
  ["Make it loop forever and stagger the cards by 3 frames", []],
];

for (const [request, expected] of SHORT_CASES) {
  test(`reads ${request.slice(0, 48)}`, () => {
    assertAsks(request, expected);
  });
}

test("a refusal far from its mention lowers the confidence more than a refusal beside it", () => {
  const clear = "Add a gradient. No glow and no blur please.";
  const far = "Avoid any of the usual finishing effects on the title such as a glow";
  assert.ok(partsConfidence(clear, featuresAsked(clear)) > partsConfidence(far, featuresAsked(far)));
});
