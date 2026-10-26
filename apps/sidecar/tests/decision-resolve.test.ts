// Pre-resolution at build-kit time: no model resolves nothing and asks nothing; a confident model's pick lands in the kit lines with its band, after one request per stage; a failing model leaves the word search to the tools.
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { makeHostProfile, makeInventory, type HostCapabilityProfile } from "@extynt/capability-catalogue";
import { clearResolutions, resolveRequestTerms, resolvedLines } from "../src/decision-resolve.js";
import { representativeSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { picked, scriptedModel, serviceOver, yesNo } from "./decision-fakes.js";

beforeEach(() => clearResolutions());

const host = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" };
const profile = (): HostCapabilityProfile => makeHostProfile(makeInventory(host, [{ matchName: "ADBE Glo2", displayName: "Glow", available: true, evidence: [] }, { matchName: "ADBE Gaussian Blur 2", displayName: "Gaussian Blur", available: true, evidence: [] }]));
const sources = (): { profile: HostCapabilityProfile; snapshot: undefined; preferences: undefined } => ({ profile: profile(), snapshot: undefined, preferences: undefined });
const REQUEST = "Make the title glow softly";

test("with no decision model nothing is resolved and the kit gains no lines", async () => {
  const terms = await resolveRequestTerms(serviceOver([]).service, REQUEST, sources());
  assert.deepEqual(terms, []);
  assert.deepEqual(resolvedLines(terms), []);
});

test("a confident model's effect pick is listed with its band, after one request", async () => {
  const jev = scriptedModel(() => picked("ADBE Glo2"));
  const terms = await resolveRequestTerms(serviceOver([jev.model]).service, REQUEST, sources());
  assert.equal(jev.calls.length, 1);
  const effect = terms.find((term) => term.kind === "effect");
  assert.equal(effect?.key, "ADBE Glo2");
  assert.match(resolvedLines(terms).join("\n"), /ADBE Glo2.*\[(act|verify)\]/);
});

test("the same request is not asked twice", async () => {
  const jev = scriptedModel(() => picked("ADBE Glo2"));
  const { service } = serviceOver([jev.model]);
  await resolveRequestTerms(service, REQUEST, sources());
  const asked = jev.calls.length;
  await resolveRequestTerms(service, REQUEST, sources());
  assert.equal(jev.calls.length, asked);
});

test("a timing-out model resolves nothing the word search did not", async () => {
  const jev = scriptedModel(() => picked("ADBE Glo2"), "timeout");
  const terms = await resolveRequestTerms(serviceOver([jev.model]).service, REQUEST, sources());
  assert.equal(terms.every((term) => term.band === "word-search"), true);
});

const sharedName = (): ProjectSnapshot => ({ ...representativeSnapshot, compositions: representativeSnapshot.compositions.map((composition) => ({ ...composition, layers: composition.layers.map((layer) => ({ ...layer, name: layer.name.startsWith("TITLE") ? "BRAND_TITLE" : layer.name })) })) });
const layerIdsFor = async (snapshot: ProjectSnapshot): Promise<string[]> => {
  const jev = scriptedModel(() => yesNo(false));
  const terms = await resolveRequestTerms(serviceOver([jev.model]).service, "Trim the BRAND_TITLE layer to 4 seconds", { ...sources(), snapshot });
  return terms.filter((term) => term.kind === "layer").map((term) => term.key);
};

test("a layer name shared by several compositions lists only the open composition's layer", async () => {
  assert.deepEqual(await layerIdsFor({ ...sharedName(), activeCompositionId: "comp-main" }), ["layer-title"]);
});

test("the same request follows the open composition when it changes", async () => {
  const snapshot = sharedName();
  assert.deepEqual(await layerIdsFor({ ...snapshot, activeCompositionId: "comp-main" }), ["layer-title"]);
  assert.deepEqual(await layerIdsFor({ ...snapshot, activeCompositionId: "comp-square" }), ["layer-social-title"]);
});
