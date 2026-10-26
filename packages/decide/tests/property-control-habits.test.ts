// Habits on property and control questions: the habitual candidate is marked and explained, wins an offline tie, and a confident model answer that leaves it is held while the request does not name another candidate.
import assert from "node:assert/strict";
import test from "node:test";
import { controlChoice, decide, jevDecisionModel, propertyChoice } from "../src/index.js";
import { answersReply, fakeFetch } from "./support.js";

const PROPERTIES = [
  { key: "fill.opacity", title: "Fill Opacity", group: "Contents" },
  { key: "stroke.opacity", title: "Stroke Opacity", group: "Contents" },
  { key: "stroke.width", title: "Stroke Width", group: "Contents" },
];
const CONTROLS = [
  { matchName: "fill-0005", displayName: "Horizontal Feather", valueType: "slider" },
  { matchName: "fill-0006", displayName: "Vertical Feather", valueType: "slider" },
  { matchName: "fill-0003", displayName: "Color", valueType: "color" },
];
const propertyHabit = { score: { "stroke.opacity": 4 }, note: { "stroke.opacity": "the user used it 4 times, last today" } };
const controlHabit = { score: { "fill-0006": 4 }, note: { "fill-0006": "the user used it 4 times, last today" } };

function modelAnswering(label: string, others: Readonly<Record<string, number>>) {
  const { fetch } = fakeFetch(answersReply({ only: { type: "choice", choice: label, confidence: 0.95, probabilities: { [label]: 0.97, ...others } } }));
  return { models: [jevDecisionModel({ apiKey: "k", fetch })] };
}

test("a habit is explained to the model and marks only the habitual candidate", () => {
  const plain = propertyChoice(PROPERTIES);
  const habitual = propertyChoice(PROPERTIES, propertyHabit);
  assert.doesNotMatch(plain.instructions, /usual choice/);
  assert.match(habitual.instructions, /usual choice/);
  assert.match(String(habitual.labels["stroke.opacity"]), /used it 4 times/);
  assert.doesNotMatch(String(habitual.labels["fill.opacity"]), /used it/);
});

test("the offline answer to an equal fit goes to the habitual property and the habitual control", () => {
  const state = { phrase: "opacity", target: "Shape Layer" };
  assert.equal(propertyChoice(PROPERTIES).deterministic(state), "none");
  assert.equal(propertyChoice(PROPERTIES, propertyHabit).deterministic(state), "stroke.opacity");
  const feather = { phrase: "feather", effect: "Fill" };
  assert.equal(controlChoice(CONTROLS).deterministic(feather), "none");
  assert.equal(controlChoice(CONTROLS, controlHabit).deterministic(feather), "fill-0006");
});

test("a confident model answer that leaves the habitual property is held, unless the phrase names the other one", async () => {
  const spec = propertyChoice(PROPERTIES, propertyHabit);
  const held = await decide({ phrase: "opacity", target: "Shape Layer" }, spec, modelAnswering("fill.opacity", { "stroke.opacity": 0.01 }));
  assert.deepEqual([held.label, held.source], ["stroke.opacity", "deterministic"]);
  const named = await decide({ phrase: "the fill opacity", target: "Shape Layer" }, spec, modelAnswering("fill.opacity", { "stroke.opacity": 0.01 }));
  assert.deepEqual([named.label, named.source], ["fill.opacity", "decision-model"]);
});

test("a confident model answer that leaves the habitual control is held, unless the phrase names the other one", async () => {
  const spec = controlChoice(CONTROLS, controlHabit);
  const held = await decide({ phrase: "feather", effect: "Fill" }, spec, modelAnswering("fill-0005", { "fill-0006": 0.01 }));
  assert.deepEqual([held.label, held.source], ["fill-0006", "deterministic"]);
  const named = await decide({ phrase: "horizontal feather", effect: "Fill" }, spec, modelAnswering("fill-0005", { "fill-0006": 0.01 }));
  assert.deepEqual([named.label, named.source], ["fill-0005", "decision-model"]);
});

test("a habit never lifts a candidate over one the phrase names, offline", () => {
  const fillHabit = { score: { "fill.opacity": 6 }, note: {} };
  assert.equal(propertyChoice(PROPERTIES, fillHabit).deterministic({ phrase: "lower the stroke opacity", target: "Shape Layer" }), "stroke.opacity");
  const verticalHabit = { score: { "fill-0006": 6 }, note: {} };
  assert.equal(controlChoice(CONTROLS, verticalHabit).deterministic({ phrase: "the horizontal feather", effect: "Fill" }), "fill-0005");
});
