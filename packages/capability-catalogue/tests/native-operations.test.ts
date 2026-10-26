// Tests the native operation registry, its schemas and its coverage of the plan types.
import { TEXT_DOCUMENT_FIELDS, representativeSnapshot } from "@extynt/project-graph";
import { type JsonObject } from "@extynt/decode";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { computePlanDigest, validateActionPlan } from "@extynt/action-plan";
import { EFFECT_HOST_CAVEATS, NATIVE_OPERATION_REGISTRY, PLAN_TYPE_CONTRACTS, findNativeOperation, findNativeOperations, makeHostProfile, makeInventory, nativeOperationCoverage, planTypesMissingContracts, searchNativeOperations, type PlanTypeContract } from "../src/index.js";

const ACTION_PLAN_SOURCE = readdirSync("packages/action-plan/src", { recursive: true, encoding: "utf8" }).filter((entry) => entry.endsWith(".ts")).sort().map((entry) => readFileSync(`packages/action-plan/src/${entry}`, "utf8")).join("\n");

const HOST_SOURCE = readdirSync("apps/panel/host").filter((entry) => entry.endsWith(".jsx") && !/^(collection|catalogue)/.test(entry)).sort().map((entry) => readFileSync(`apps/panel/host/${entry}`, "utf8")).join("\n");

const VERIFY_SOURCE = readdirSync("apps/sidecar/src/verify").filter((entry) => entry.endsWith(".ts")).sort().map((entry) => readFileSync(`apps/sidecar/src/verify/${entry}`, "utf8")).join("\n");

function assertPanelReports(source: string, bases: readonly string[]): void {
  for (const basis of bases) assert.ok(source.includes(`"${basis}"`), `the panel still reports ${basis}`);
}

function assertHostReports(source: string, fields: readonly string[]): void {
  for (const field of fields) assert.ok(source.includes(field), `the host still reports ${field}`);
}

function assertExpressionVerdictNotes(contracts: ReadonlyArray<PlanTypeContract | undefined>): void {
  for (const contract of contracts) {
    const notes = contract?.notes ?? "";
    assert.match(notes, /referenced|reads them|live inputs/, `the reading case is described: ${notes}`);
    assert.match(notes, /ignored|does not read/, `the non-reading case is described: ${notes}`);
    assert.match(notes, /unknown|could not tell/, `the undecidable case is described: ${notes}`);
  }
}

function assertDigestEvidence(animate: PlanTypeContract, expression: PlanTypeContract): void {
  assert.match(animate.notes ?? "", /digest/);
  assert.match(animate.notes ?? "", /applied_unverified|not verified/);
  assert.match(expression.notes ?? "", /sampled/);
}

function assertLoopSharesExpressionReadBack(loop: PlanTypeContract, expression: PlanTypeContract): void {
  assert.equal(loop.readBack, expression.readBack);
  assert.equal(loop.unobserved.join(" "), expression.unobserved.join(" "));
}

test("native operation registry covers every declared AE domain and reports executable coverage honestly", () => {
  const coverage = nativeOperationCoverage();
  const expectedDomains = ["project", "composition", "layer", "transform", "timing", "parenting", "track-matte", "text", "mask", "shape", "camera", "light", "3d-material", "audio", "effects", "expressions", "markers", "footage", "guides-color", "render", "essential-graphics", "presets", "layer-styles", "tracking", "puppet", "roto"];
  assert.equal(coverage.total, NATIVE_OPERATION_REGISTRY.length);
  assert.deepEqual(Object.keys(coverage.domains).sort(), expectedDomains.sort());
  assert.equal(coverage.statuses.implemented, 83);
  assert.equal(coverage.fixtureBacked, coverage.statuses.implemented);
  assert.equal(coverage.runtimeVerified, 0);
  assert.equal(coverage.statuses.documented_only, 0);
  assert.equal(coverage.statuses.probe_needed, 0);
  assert.equal(coverage.statuses.unsupported, 5);
});

test("native operation registry entries remain typed, stable, and searchable without exposing code", () => {
  const ids = new Set<string>();
  for (const entry of NATIVE_OPERATION_REGISTRY) {
    assert.ok(/^[-a-z]+\.[-a-z]+$/.test(entry.id));
    assert.ok(!ids.has(entry.id)); ids.add(entry.id);
    assert.equal(entry.version, "0.1");
    assert.equal(entry.inputSchema.type, "object");
    assert.ok(entry.aeTarget.length > 0);
    assert.ok(entry.provenance.length > 0);
  }
  assert.deepEqual(searchNativeOperations("render").map((entry) => entry.id), ["render.add-to-queue", "render.configure", "render.execute", "render.output-settings", "render.send-to-media-encoder", "composition.update-settings"]);
  assert.deepEqual(searchNativeOperations("Text Animator", 4).map((entry) => entry.id), ["text.animator", "text.ensure-animator", "text.animate-selector", "expressions.set-clear"]);
});

test("native search ranks by how many query words match (OR) and by how closely they name an operation", () => {
  const animate = searchNativeOperations("animate property keyframes").map((entry) => entry.id);
  assert.equal(animate[0], "property.animate", "the plan type the words name is ranked first");
  assert.equal(searchNativeOperations("property quasar")[0]?.id, "property.animate");
  assert.deepEqual(searchNativeOperations("quasar nebula"), []);
  assert.equal(searchNativeOperations("trim paths quasar")[0]?.id, "shape.operator");
  const both = searchNativeOperations("trim paths").map((entry) => entry.id);
  assert.equal(both[0], "shape.operator");
  assert.equal(searchNativeOperations("render_composition")[0]?.planTypes[0], "render_composition");
  assert.deepEqual(searchNativeOperations("render").slice(0, 5).map((entry) => entry.id.split(".")[0]), ["render", "render", "render", "render", "render"]);
  assert.equal(searchNativeOperations("render").at(-1)?.id, "composition.update-settings", "a description-only hit sorts last");
  assert.deepEqual(searchNativeOperations("gradient").map((entry) => entry.id), ["shape.gradient", "vector.create-inline"]);
  assert.equal(searchNativeOperations("", 500).length, NATIVE_OPERATION_REGISTRY.length, "the whole registry fits one answer");
  assert.equal(searchNativeOperations("render", 0).length, 1, "limit is clamped to at least 1");
});

test("a plan type served by several registry entries reports every one of them", () => {
  assert.deepEqual(findNativeOperations("add_shape_item").map((entry) => entry.id), ["shape.primitive", "shape.gradient", "shape.operator"]);
  assert.deepEqual(findNativeOperations("update_shape_item").map((entry) => entry.id), ["shape.primitive", "shape.gradient", "shape.operator"]);
  assert.deepEqual(findNativeOperations("animate_property").map((entry) => entry.id), ["property.animate", "text.animate-selector"]);
  assert.deepEqual(findNativeOperations("create_layer").map((entry) => entry.id), ["layer.create", "layer.add-source"]);
  assert.deepEqual(findNativeOperations("render_composition").map((entry) => entry.id), ["render.add-to-queue", "render.configure", "render.output-settings", "render.send-to-media-encoder", "render.execute"]);
  assert.deepEqual(findNativeOperations("shape.gradient").map((entry) => entry.id), ["shape.gradient"]);
  assert.equal(findNativeOperation("add_shape_item")?.id, "shape.primitive");
});

test("every implemented operation has a useful on-demand schema while search rows stay shallow", () => {
  for (const entry of NATIVE_OPERATION_REGISTRY.filter((candidate) => candidate.implementationStatus === "implemented")) {
    assert.ok(entry.inputSchema.required.length > 0, `${entry.id} needs required inputs`);
    assert.ok(Object.keys(entry.inputSchema.properties).length > 0, `${entry.id} needs described inputs`);
    for (const required of entry.inputSchema.required) assert.ok(entry.inputSchema.properties[required], `${entry.id} requires ${required} but does not describe it`);
  }
  const text = NATIVE_OPERATION_REGISTRY.find((entry) => entry.id === "text.set-document");
  assert.ok(text);
  assert.deepEqual(Object.keys(text.inputSchema.properties).sort(), ["characterRanges", "compositionId", "layerId", ...Object.keys(TEXT_DOCUMENT_FIELDS)].sort(), "the described schema is generated from the typed text contract");
  const camera = NATIVE_OPERATION_REGISTRY.find((entry) => entry.id === "camera.set-options");
  assert.equal(camera?.inputSchema.properties.options?.description, "Allowlisted: zoom, depthOfField, focusDistance, aperture, blurLevel.");
});

test("camera.dolly is a described camera operation that compiles to dolly_camera and names the distance it takes", () => {
  const dolly = NATIVE_OPERATION_REGISTRY.find((entry) => entry.id === "camera.dolly");
  assert.ok(dolly);
  assert.deepEqual(dolly.applicability, ["camera"]);
  assert.deepEqual(dolly.inputSchema.required, ["compositionId", "layerId", "keyframes"]);
  assert.match(dolly.inputSchema.properties.keyframes?.description ?? "", /distance = pixels from the camera to its Point of Interest/);
  assert.match(dolly.verificationBasis ?? "", /camera-dolly-axis/);
});

test("the advertised expression and keyframe verification bases name the verdicts the receipt actually reports", () => {
  const panel = VERIFY_SOURCE;
  const probe = HOST_SOURCE;
  const panelBases = ["property-keyframes-superseded-by-expression", "property-keyframe-digest", "property-keyframes-expression-keys-unknown", "property-keyframes-not-in-snapshot", "expression-motion-not-sampled", "expression-value-constant-not-motion", "property-expression-motion", "property-expression-state", "property-expression-cleared", "expression-evaluation-error"];
  assertPanelReports(panel, panelBases);
  assertHostReports(probe, ["expressionSamples", "expressionChanges", "expressionSampledError", "expressionExistingKeys", "expressionKeysReferenced", "expressionKeyValues"]);
  const animate = PLAN_TYPE_CONTRACTS.animate_property;
  const expression = PLAN_TYPE_CONTRACTS.set_expression;
  const loop = PLAN_TYPE_CONTRACTS.set_loop;
  assert.ok(animate && expression && loop);
  assertExpressionVerdictNotes([animate, expression]);
  assertDigestEvidence(animate, expression);
  assertLoopSharesExpressionReadBack(loop, expression);
});

test("the expression plan schema matches the validator's fields and the evidence the panel carries", () => {
  assert.deepEqual(planTypesMissingContracts(), []);
  const validator = ACTION_PLAN_SOURCE;
  const panel = VERIFY_SOURCE;
  const setClear = NATIVE_OPERATION_REGISTRY.find((entry) => entry.id === "expressions.set-clear");
  assert.ok(setClear);
  assert.deepEqual([...setClear.inputSchema.required].sort(), ["compositionId", "enabled", "layerId", "propertyPath", "source"]);
  assert.deepEqual(Object.keys(setClear.inputSchema.properties).sort(), ["compositionId", "effectPath", "enabled", "layerId", "propertyPath", "source"]);
  assert.match(validator, /set_expression requires a bounded source, enabled flag, and exact property path/);
  assert.match(String(setClear.inputSchema.properties.effectPath?.description), /effect control/i, "the optional effectPath is described as the effect-control form");
  assert.match(panel, /if \(item\.enabled === false \|\| typeof item\.source !== "string" \|\| !item\.source\) continue;/);
  const loop = NATIVE_OPERATION_REGISTRY.find((entry) => entry.id === "expressions.loop");
  assert.ok(loop);
  assert.deepEqual(loop.planTypes, ["set_loop"]);
  assert.ok(loop.preconditions.includes("property has 2+ keyframes"), "the contract states the validator's LOOP_REQUIRES_KEYFRAMES rule");
  const animate = NATIVE_OPERATION_REGISTRY.find((entry) => entry.id === "property.animate");
  assert.ok(animate);
  assert.match(String(setClear.verificationBasis), /ignored|unknown/, "the set/clear basis names the keyframe classification");
  assert.doesNotMatch(String(loop.verificationBasis), /fresh exact property expression state/);
  assert.match(String(loop.verificationBasis), /set_expression/);
  assert.match(String(animate.verificationBasis), /property-keyframes-expression-keys-unknown/);
});

test("the expressions.set-clear schema is exactly the field set the plan validator accepts", () => {
  const setClear = NATIVE_OPERATION_REGISTRY.find((entry) => entry.id === "expressions.set-clear");
  assert.ok(setClear);
  const target = { compositionId: "comp-main", layerId: "layer-title", snapshotFingerprint: representativeSnapshot.fingerprint, selectionFingerprint: representativeSnapshot.selectionFingerprint };
  const build = (extraTarget: JsonObject, extraOperation: JsonObject = {}): JsonObject => {
    const plan = { schemaVersion: "0.2" as const, planId: "catalogue-schema-agreement", snapshotFingerprint: representativeSnapshot.fingerprint, selectionFingerprint: representativeSnapshot.selectionFingerprint, freshness: representativeSnapshot.freshness, summary: "Schema agreement", requiresApproval: true as const, bounds: { maxOperations: 1, maxExpressionLength: 64 }, preconditions: [], conflicts: [], postconditions: [], operations: [{ type: "set_expression", target: { ...target, ...extraTarget }, source: "value", enabled: true, ...extraOperation }], digest: "" };
    return { ...plan, digest: computePlanDigest(plan) };
  };
  const effectPath = "ADBE Effect Parade/ADBE Gaussian Blur 2";
  assert.equal(validateActionPlan(build({ effectPath, propertyPath: `${effectPath}/ADBE Gaussian Blur 2-0001` }), representativeSnapshot).ok, true, "every advertised field is one the validator accepts");
  assert.equal(validateActionPlan(build({ propertyPath: "ADBE Transform Group/ADBE Opacity" }), representativeSnapshot).ok, true, "the non-effect form the schema also describes still validates");
  const unknown = validateActionPlan(build({ propertyPath: "ADBE Transform Group/ADBE Opacity" }, { effectMatchName: "ADBE Gaussian Blur 2" }), representativeSnapshot);
  if (unknown.ok) assert.fail("an unadvertised field must be refused");
  assert.equal(unknown.code, "UNKNOWN_FIELD", "a field the schema does not advertise is refused, so the two cannot drift apart");
});

test("the effects.ensure registry entry says unattended success is a host fact, not an implementation claim", () => {
  const ensure = NATIVE_OPERATION_REGISTRY.find((entry) => entry.id === "effects.ensure");
  assert.ok(ensure);
  assert.equal(ensure.implementationStatus, "implemented", "implemented describes extynt's handler, not this host's permission");
  assert.match(ensure.description, /host profile/i);
  assert.match(ensure.description, /unattended/i);
  assert.ok(ensure.preconditions.some((precondition) => /operationStatus/.test(precondition)), "the host profile's operationStatus is stated as a precondition");
});

test("a profile entry for an effect that needs manual setup is never offered as unattended-capable", () => {
  const host = { application: "After Effects" as const, version: "26.2.1x2", buildNumber: "2", platform: "macOS", architecture: "arm64" };
  const inventory = makeInventory(host, ["ADBE Dropdown Control", "CINEMA 4D Effect", "ADBE Gaussian Blur 2"].map((matchName) => ({ matchName, displayName: matchName, available: true, evidence: [{ kind: "observed" as const, source: "host" as const }] })));
  const profile = makeHostProfile(inventory);
  for (const matchName of ["ADBE Dropdown Control", "CINEMA 4D Effect"]) {
    const caveat = EFFECT_HOST_CAVEATS[matchName];
    assert.ok(caveat, `${matchName} carries a host caveat`);
    const entry = profile.entries.find((candidate) => candidate.matchName === matchName);
    assert.ok(entry);
    assert.equal(entry.operationStatus, "unsupported", `${matchName} cannot be applied unattended`);
    assert.equal(entry.availability, "available", "the effect is installed; only unattended application is refused");
    assert.ok((entry.requirements ?? []).includes(caveat.message), "the caveat text travels with the profile entry the model reads");
    assert.equal(profile.probeNeeded.includes(entry.id), false, "a caved effect is never queued as a probe candidate: probing it would open the same dialog");
  }
  assert.equal(profile.entries.find((candidate) => candidate.matchName === "ADBE Gaussian Blur 2")?.operationStatus, "probeNeeded", "an ordinary installed effect still awaits its probe");
});

test("the animate-control schema advertises only the fields the plan validator accepts", () => {
  const animate = NATIVE_OPERATION_REGISTRY.find((entry) => entry.id === "effects.animate-control");
  assert.ok(animate);
  assert.deepEqual(Object.keys(animate.inputSchema.properties).sort(), ["compositionId", "effectMatchName", "keyframeMode", "keyframes", "layerId", "propertyPath", "role"]);
  const propertyAnimate = NATIVE_OPERATION_REGISTRY.find((entry) => entry.id === "property.animate");
  assert.ok(propertyAnimate);
  assert.equal(Object.hasOwn(propertyAnimate.inputSchema.properties, "expression"), false, "animate_property advertises no inline expression; set_expression is the expression route");
});

test("the transform.set schema advertises every typed native transform role, Anchor Point included", () => {
  const transform = NATIVE_OPERATION_REGISTRY.find((entry) => entry.id === "transform.set");
  assert.ok(transform);
  const advertised = [...(transform.inputSchema.properties.role?.enum ?? [])].sort();
  assert.deepEqual(advertised, ["transform.anchor", "transform.opacity", "transform.position", "transform.rotation", "transform.scale"]);
  const validator = ACTION_PLAN_SOURCE;
  for (const role of advertised) assert.ok(validator.includes(`"${role}":`), `the validator's role table still carries ${role}`);
});

test("the gradient operation documents the host's refusal to script colour stops, as a host limit", () => {
  const gradient = NATIVE_OPERATION_REGISTRY.find((entry) => entry.id === "shape.gradient");
  assert.ok(gradient);
  const text = `${gradient.description} ${(gradient.preconditions ?? []).join(" ")} ${gradient.inputSchema.properties.groupId?.description ?? ""} ${JSON.stringify(gradient.inputSchema.properties)}`;
  assert.match(text, /NO_VALUE/, "the refusal is attributed to the property's AE value type");
  assert.match(text, /After Effects/, "the limit is named as the host's");
  assert.match(text, /by hand/, "the workaround is stated, so the model stops retrying");
  assert.doesNotMatch(text, /not scriptable in AE\.$/, "the bare unexplained claim is gone");
});
