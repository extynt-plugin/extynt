// Checks the execution role: a plan of a short animated piece takes it, a plan or review of a big scene that asks nothing to be built or animated does not, and a build in stages still does.
import assert from "node:assert/strict";
import test from "node:test";
import { specialistsOf } from "../src/route-decisions.js";

test("a plan or storyboard of a short animated piece takes execution, motion and planner", () => {
  const animatedPlan = ["motion", "execution", "planner"];
  assert.deepEqual(specialistsOf("Plan a 6 second sting: the logo bounces in, the letters pop one by one, then it fades out"), animatedPlan);
  assert.deepEqual(specialistsOf("Storyboard a 5 second sting for the brand with a bounce and a fade"), animatedPlan);
  assert.deepEqual(specialistsOf("Outline a short animated logo sting with a bounce"), animatedPlan);
  assert.deepEqual(specialistsOf("Draft a storyboard for an animated 8 second title sting"), animatedPlan);
});

test("a plan or review of a big scene that asks nothing to be built takes no execution", () => {
  const planAndReview = ["planner", "reviewer"];
  assert.deepEqual(specialistsOf("Plan the 40 second scene with six sections and review the rendered frames"), planAndReview);
  assert.deepEqual(specialistsOf("Outline the 60 second scene with eight sections and check the frames"), planAndReview);
  assert.deepEqual(specialistsOf("Storyboard the big scene in twelve shots and review the storyboard"), planAndReview);
  assert.deepEqual(specialistsOf("Make a plan for the big scene: twelve shots, then review the frames for mistakes"), planAndReview);
  assert.deepEqual(specialistsOf("Create a storyboard for the 40 second scene with six sections and review it"), planAndReview);
});

test("a build in stages, or a build of a motion, takes execution", () => {
  assert.deepEqual(specialistsOf("Build the 45 second product film in stages, one section at a time, in order"), ["execution", "planner"]);
  assert.deepEqual(specialistsOf("Animate the 45 second product film in stages, one section at a time"), ["motion", "execution"]);
});
