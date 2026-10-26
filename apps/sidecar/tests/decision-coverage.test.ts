// The request-missing decision: a confident model that finds an asked feature shown relaxes the coverage refusal for it, a model that finds it missing changes nothing, and with no model or a failure the sidecar's reading stands; one request per check.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { applying, scriptedModel, serviceOver } from "./decision-fakes.js";
import { clearBook } from "../src/decision-book.js";
import { primeRequestMissing } from "../src/decision-prime.js";
import { forgetRequestedFeatures, missingFeatures } from "../src/request-coverage.js";
import { snapshotOf, step } from "./coverage-fixtures.js";

beforeEach(() => clearBook());

const GOAL = "Add a glow to the title.";
const APPLIED = [step("add_essential_property")];
const empty = () => snapshotOf([]);
const seesMissing = (missing: readonly string[]) => scriptedModel((question) => (question.kind === "labels" ? applying(new Set(missing), question.labels.map((entry) => entry.label)) : applying(new Set(), [])));

test("with no model the sidecar's reading stands and nothing is asked", async () => {
  await primeRequestMissing(serviceOver([]).service, GOAL, APPLIED);
  assert.equal(missingFeatures(GOAL, empty(), APPLIED).length, 1);
});

test("a confident model that finds the glow shown relaxes the refusal, after one request", async () => {
  const jev = seesMissing([]);
  forgetRequestedFeatures(GOAL);
  await primeRequestMissing(serviceOver([jev.model]).service, GOAL, APPLIED);
  await primeRequestMissing(serviceOver([jev.model]).service, GOAL, APPLIED);
  assert.equal(jev.calls.length, 1);
  assert.equal(missingFeatures(GOAL, empty(), APPLIED).length, 0);
});

test("a model that finds the glow missing, or one that fails, leaves it missing", async () => {
  await primeRequestMissing(serviceOver([seesMissing(["glow"]).model]).service, GOAL, APPLIED);
  assert.equal(missingFeatures(GOAL, empty(), APPLIED).length, 1);
  clearBook();
  await primeRequestMissing(serviceOver([scriptedModel(() => applying(new Set(), []), "timeout").model]).service, GOAL, APPLIED);
  assert.equal(missingFeatures(GOAL, empty(), APPLIED).length, 1);
});
