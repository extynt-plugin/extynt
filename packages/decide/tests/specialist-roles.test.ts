// Unit tests for the specialist roles a request needs: motion, planner, reviewer, expression and execution cues in five languages, and long motion briefs that stay motion-only.
import assert from "node:assert/strict";
import test from "node:test";
import { specialistsOf } from "../src/route-decisions.js";

const motionOnly = (request: string): void => assert.deepEqual(specialistsOf(request), ["motion"], request);

test("short motion requests in Spanish, German, French and Japanese take the motion specialist", () => {
  motionOnly("Haz que el logo rebote al aterrizar");
  motionOnly("Anima el título con un desliz suave");
  motionOnly("Haz que el título aparezca con un fundido");
  motionOnly("Lass den Titel federnd einfliegen");
  motionOnly("Lass den Text sanft einblenden");
  motionOnly("Fais rebondir le logo à l'arrivée");
  motionOnly("Fais apparaître le titre en fondu");
  motionOnly("ロゴをバウンスさせて");
  motionOnly("タイトルをフェードインさせて");
  motionOnly("Make the logo bounce when it lands");
});

test("a request to plan or outline a reel, sequence or storyboard takes the planner", () => {
  assert.deepEqual(specialistsOf("Outline a 20 second sequence for the reel"), ["planner"]);
  assert.deepEqual(specialistsOf("Draft a storyboard for the reel"), ["planner"]);
  assert.deepEqual(specialistsOf("Plan the shot list for a 15 second reel"), ["planner"]);
  assert.deepEqual(specialistsOf("Planifica un reel de 15 segundos con intro y cierre"), ["planner"]);
  assert.deepEqual(specialistsOf("Plane die Sequenz für den Clip"), ["planner"]);
  assert.deepEqual(specialistsOf("Fais un plan de la séquence du teaser"), ["planner"]);
  assert.deepEqual(specialistsOf("リールの構成を計画して"), ["planner"]);
});

test("a request to check typos, spelling or errors takes the reviewer in five languages", () => {
  assert.deepEqual(specialistsOf("Check the title for typos and spelling"), ["reviewer"]);
  assert.deepEqual(specialistsOf("Proof the captions for spelling mistakes"), ["reviewer"]);
  assert.deepEqual(specialistsOf("Revisa los errores de ortografía en los títulos"), ["reviewer"]);
  assert.deepEqual(specialistsOf("Prüfe die Texte auf Rechtschreibfehler"), ["reviewer"]);
  assert.deepEqual(specialistsOf("Vérifie les fautes d'orthographe dans les titres"), ["reviewer"]);
  assert.deepEqual(specialistsOf("タイトルの誤字を確認して"), ["reviewer"]);
});

test("an expression is asked by its own cue: a wiggle, a count, a link or a forever spin", () => {
  assert.deepEqual(specialistsOf("Make the star wiggle"), ["expression"]);
  assert.deepEqual(specialistsOf("Count up the score from 0 to 100 with an expression"), ["expression"]);
  assert.deepEqual(specialistsOf("Make the gear rotate forever without keyframes"), ["expression"]);
});

test("a long motion brief with many nouns and lists is motion only", () => {
  motionOnly("Animate the title: the title enters from the left with a springy ease and an overshoot, the subtitle follows with a short stagger, the logo settles with a bit of drift, and the whole thing keeps a steady rhythm across the thirty seconds.");
  motionOnly("Haz que el título aparezca con un fundido y el logo rebote suavemente. Mueve la cámara con un desliz lento, con un ritmo elegante, y luego deja que todo se asiente con un poco de rebote, con una transición fluida y un final limpio.");
  motionOnly("Lass den Titel federnd einblenden, dann den Hintergrund langsam ausblenden. Die Bewegung soll weich sein, mit einem Overshoot beim Landen, und jede Ebene bekommt einen eigenen Rhythmus, der Schatten schwebt mit, das Logo landet in einer weichen Abfolge.");
  motionOnly("Fais apparaître le titre en fondu, puis fais rebondir le logo, avec un mouvement fluide et un rythme élégant. Chaque calque glisse avec une transition douce, l'ombre suit et le texte se stabilise à la fin.");
  motionOnly("タイトルをフェードインさせて、ロゴは少しバウンスさせてください。動きはなめらかに、カードはスライドで入ってきて、影もゆっくり動いて、最後は落ち着かせる感じで、全体のタイミングを整えてください。");
  motionOnly("Bounce the logo with an overshoot, fade the title in, and slide the card from the left");
  motionOnly("Ease the card sliding in so it feels heavy, then settles");
});

test("a list of motion verbs does not pull in a plan, a build in stages or an expression", () => {
  motionOnly("Make the title bounce, fade in, and drift up with a soft ease");
  motionOnly("Make a 30 second promo with punchy motion, a bounce and a stagger on the title");
});

test("a plain edit, a refused cue and an outline of a shape take no specialist", () => {
  assert.deepEqual(specialistsOf("Rename the layer to HERO_TEXT"), []);
  assert.deepEqual(specialistsOf("Set the title opacity to 60%"), []);
  assert.deepEqual(specialistsOf("Add an outline to the logo"), []);
  assert.deepEqual(specialistsOf("Don't animate the title, just set its opacity to 40%"), []);
});

test("a multi-part build takes the planner for its counted or listed parts", () => {
  assert.deepEqual(specialistsOf("Make a 30 second promo with an intro, three feature sections and an outro"), ["planner"]);
  assert.ok(specialistsOf("Four scenes of a weather report, each with a wiggling cloud").includes("planner"));
});
