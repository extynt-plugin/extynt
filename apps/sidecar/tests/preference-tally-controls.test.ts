// Habits for effect controls and transform properties: a verified plan's writes are tallied once, an undo counts against them, and the decision questions carry the habit only for the candidates in the shortlist.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { beforeEach } from "node:test";
import type { LabelEntry, Question } from "@extynt/decide";
import type { Operation } from "@extynt/action-plan";
import { makeHostProfile, makeInventory, type HostCapabilityProfile } from "@extynt/capability-catalogue";
import { clearResolutions, resolveRequestTerms } from "../src/decision-resolve.js";
import { PreferenceTally } from "../src/preference-tally.js";
import { tallyOperations } from "../src/preference-tally-plan.js";
import { picked, scriptedModel, serviceOver } from "./decision-fakes.js";

beforeEach(() => clearResolutions());

const host = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" };
const target = { compositionId: "c", layerId: "l", snapshotFingerprint: "s", selectionFingerprint: "f" };
const GLOW_CONTROLS = ["ADBE Glo2-0003", "ADBE Glo2-0004"].map((matchName, index) => ({ path: matchName, matchName, displayName: ["Glow Radius", "Glow Intensity"][index] ?? "", valueType: "slider" }));

function labelsOf(question: Question | undefined): ReadonlyArray<LabelEntry> {
  return question !== undefined && "labels" in question ? question.labels : [];
}

function describedAs(question: Question | undefined, label: string): string {
  return labelsOf(question).find((entry) => entry.label === label)?.description ?? "";
}

function withTally(run: (tally: PreferenceTally) => Promise<void> | void): Promise<void> | void {
  const directory = mkdtempSync(join(tmpdir(), "tally-controls-"));
  const done = (): void => rmSync(directory, { recursive: true, force: true });
  const result = run(new PreferenceTally(directory, () => 0, () => true));
  return result instanceof Promise ? result.finally(done) : done();
}

function glowProfile(): HostCapabilityProfile {
  const profile = makeHostProfile(makeInventory(host, [{ matchName: "ADBE Glo2", displayName: "Glow", available: true, evidence: [] }]));
  return { ...profile, entries: profile.entries.map((entry) => (entry.matchName === "ADBE Glo2" ? { ...entry, controls: GLOW_CONTROLS } : entry)) };
}

const writes: { readonly operations: Operation[] } = { operations: [
  { type: "set_effect_control", target: { ...target, propertyPath: "ADBE Effect Parade/ADBE Glo2/ADBE Glo2-0004" }, effectMatchName: "ADBE Glo2", value: 40 },
  { type: "animate_control", target: { ...target, propertyPath: "ADBE Effect Parade/ADBE Glo2#2/ADBE Glo2-0004" }, role: "x", effectMatchName: "ADBE Glo2" },
  { type: "set_layer_property", target, role: "transform.scale", propertyPath: "ADBE Transform Group/ADBE Scale", value: 50 },
  { type: "animate_property", target, role: "text.fill" },
] };

test("a plan's control and transform writes are read as tally operations, one per write that names its target", () => {
  assert.deepEqual(tallyOperations(writes).map(({ type, ...rest }) => rest), [{ control: "ADBE Glo2/ADBE Glo2-0004" }, { control: "ADBE Glo2/ADBE Glo2-0004" }, { property: "transform.scale" }]);
});

test("control and property habits count once per plan and an undo takes them back", () => withTally((tally) => {
  const controls = [{ key: "ADBE Glo2-0003", stored: ["ADBE Glo2/ADBE Glo2-0003"] }, { key: "ADBE Glo2-0004", stored: ["ADBE Glo2/ADBE Glo2-0004"] }];
  tally.noteApplied("p", tallyOperations(writes));
  tally.noteApplied("p", tallyOperations(writes));
  assert.deepEqual(Object.keys(tally.habits("control", controls).score), ["ADBE Glo2-0004"]);
  assert.deepEqual(Object.keys(tally.habits("property", [{ key: "transform.scale", stored: ["transform.scale"] }]).score), ["transform.scale"]);
  tally.noteUndone("p");
  assert.deepEqual(tally.habits("control", controls).score, {});
}));

test("the property question marks the habitual property and says what a habit may decide", () => withTally(async (tally) => {
  for (let index = 0; index < 4; index += 1) tally.noteApplied(`p${index}`, [{ type: "property", property: "transform.scale" }]);
  const jev = scriptedModel(() => picked("transform.scale"));
  await resolveRequestTerms(serviceOver([jev.model]).service, "make the title bigger", { profile: undefined, snapshot: undefined, preferences: tally });
  const question = jev.calls.flatMap((call) => call.questions).find((entry) => entry.kind === "choice" && entry.id.startsWith("property"));
  assert.match(question?.instructions ?? "", /usual choice/);
  assert.match(describedAs(question, "transform.scale"), /the user used it 4 times/);
  assert.doesNotMatch(describedAs(question, "transform.opacity"), /the user used/);
}));

test("the control question marks the habitual control of the resolved effect and nothing else", () => withTally(async (tally) => {
  tally.noteApplied("p", tallyOperations(writes));
  const jev = scriptedModel((question) => picked(question.id.startsWith("control") ? "ADBE Glo2-0004" : "ADBE Glo2"));
  await resolveRequestTerms(serviceOver([jev.model]).service, "glow", { profile: glowProfile(), snapshot: undefined, preferences: tally });
  const question = jev.calls.flatMap((call) => call.questions).find((entry) => entry.id.startsWith("control"));
  assert.match(question?.instructions ?? "", /usual choice/);
  assert.match(describedAs(question, "ADBE Glo2-0004"), /the user used it/);
  assert.doesNotMatch(describedAs(question, "ADBE Glo2-0003"), /the user used/);
}));
