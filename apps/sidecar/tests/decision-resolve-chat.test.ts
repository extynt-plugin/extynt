// Pre-resolution on the user's own chat model: the phrases the offline tier is unsure of go in one request per wave, an answer outside the offered candidates is rejected and logged, a timeout leaves the offline answer, and what the model settled is learned.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { beforeEach } from "node:test";
import { makeHostProfile, makeInventory, type HostCapabilityProfile } from "@extynt/capability-catalogue";
import { clearResolutions, forgetLearnedAliases, resolveRequestTerms, resolvedLines, type ResolveSources } from "../src/decision-resolve.js";
import { LearnedAliases } from "../src/learned-aliases.js";
import { picked, scriptedChatModel, scriptedModel, serviceOver, type ScriptedModel } from "./decision-fakes.js";

beforeEach(() => clearResolutions());

const host = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" };
const GLOW = { matchName: "ADBE Glo2", displayName: "Glow", available: true, evidence: [] };
const GAUSSIAN = { matchName: "ADBE Gaussian Blur 2", displayName: "Gaussian Blur", available: true, evidence: [] };
const BOX = { matchName: "ADBE Fast Box Blur", displayName: "Box Blur", available: true, evidence: [] };
const LENS = { matchName: "ADBE Camera Lens Blur", displayName: "Camera Lens Blur", available: true, evidence: [] };
const profileOf = (...effects: Array<typeof GLOW>): HostCapabilityProfile => makeHostProfile(makeInventory(host, effects));
const sourcesOf = (profile: HostCapabilityProfile, aliases?: LearnedAliases, signal?: AbortSignal): ResolveSources => ({ profile, snapshot: undefined, preferences: undefined, aliases, signal });
const REQUEST = "blur it, soften the edges, add a bloom to the title, Add Gaussian Blur";
const effectCalls = (chat: ScriptedModel): number => chat.calls.filter((call) => call.questions.some((question) => question.id.startsWith("effect"))).length;
const answerBox = (question: { readonly id: string }): ReturnType<typeof picked> => picked(question.id.startsWith("effect") ? "ADBE Fast Box Blur" : "none");

test("the unsure phrases of a job are one request, and the confident ones stay offline", async () => {
  const chat = scriptedChatModel(answerBox);
  const { service } = serviceOver([chat.model]);
  const terms = await resolveRequestTerms(service, REQUEST, sourcesOf(profileOf(GLOW, GAUSSIAN, BOX)));
  assert.equal(effectCalls(chat), 1);
  assert.deepEqual(chat.calls[0]?.questions.map((question) => question.id).filter((id) => id.startsWith("effect")), ["effect:0", "effect:1"]);
  const blurred = terms.filter((term) => term.key === "ADBE Fast Box Blur");
  assert.deepEqual(blurred.map((term) => term.phrase), ["blur it", "soften the edges"]);
  assert.equal(blurred.every((term) => term.band === "act" || term.band === "verify"), true);
  assert.equal(terms.find((term) => term.phrase === "add a bloom to the title")?.band, "word-search");
});

test("with nothing unsure the chat model is not asked at all", async () => {
  const chat = scriptedChatModel(answerBox);
  const terms = await resolveRequestTerms(serviceOver([chat.model]).service, "Add Gaussian Blur", sourcesOf(profileOf(GLOW, GAUSSIAN, BOX)));
  assert.equal(effectCalls(chat), 0);
  assert.equal(terms[0]?.key, "ADBE Gaussian Blur 2");
});

test("an answer that is not an offered candidate is rejected, logged, and the offline answer stands", async () => {
  const chat = scriptedChatModel(() => picked("ADBE Not Offered"));
  const { service, rows } = serviceOver([chat.model]);
  const terms = await resolveRequestTerms(service, REQUEST, sourcesOf(profileOf(GLOW, GAUSSIAN, BOX)));
  assert.equal(effectCalls(chat), 1);
  assert.equal(terms.some((term) => term.key === "ADBE Not Offered"), false);
  assert.deepEqual(terms.filter((term) => term.band === "unsure").map((term) => term.phrase), ["blur it", "soften the edges"]);
  assert.equal(rows.filter((row) => row.decision === "effect" && row.fallback === "malformed").length, 2);
});

test("a timing-out chat model costs one request and leaves the offline answers", async () => {
  const chat = scriptedChatModel(answerBox, "timeout");
  const { service, rows } = serviceOver([chat.model]);
  const terms = await resolveRequestTerms(service, REQUEST, sourcesOf(profileOf(GLOW, GAUSSIAN, BOX)));
  assert.equal(effectCalls(chat), 1);
  assert.equal(terms.filter((term) => term.band === "unsure").length, 2);
  assert.equal(rows.some((row) => row.fallback === "timeout"), true);
});

test("a cancelled job asks the chat model nothing", async () => {
  const chat = scriptedChatModel(answerBox);
  const cancelled = AbortSignal.abort();
  const terms = await resolveRequestTerms(serviceOver([chat.model]).service, REQUEST, sourcesOf(profileOf(GLOW, GAUSSIAN, BOX), undefined, cancelled));
  assert.equal(chat.calls.length, 0);
  assert.deepEqual(terms, []);
});

test("a configured decision model keeps the resolution to itself and the chat model is not batched", async () => {
  const jev = scriptedModel(() => picked("ADBE Glo2"));
  const chat = scriptedChatModel(answerBox);
  await resolveRequestTerms(serviceOver([jev.model, chat.model]).service, REQUEST, sourcesOf(profileOf(GLOW, GAUSSIAN, BOX)));
  assert.equal(chat.calls.length, 0);
  assert.equal(jev.calls.length >= 1, true);
});

test("what the chat model settled is learned, and the next request needs no model", async () => {
  const aliases = new LearnedAliases(mkdtempSync(join(tmpdir(), "extynt-resolve-")), () => true);
  const chat = scriptedChatModel(answerBox);
  const { service } = serviceOver([chat.model]);
  const profile = profileOf(GLOW, GAUSSIAN, BOX);
  await resolveRequestTerms(service, REQUEST, sourcesOf(profile, aliases));
  clearResolutions();
  const again = await resolveRequestTerms(service, REQUEST, sourcesOf(profile, aliases));
  assert.equal(effectCalls(chat), 1, "the second request asked nothing");
  assert.equal(again.find((term) => term.phrase === "blur it")?.band, "learned");
  assert.match(resolvedLines(again).join("\n"), /ADBE Fast Box Blur\) \[learned\]/);
});

test("a learned alias answers with no model configured at all", async () => {
  const aliases = new LearnedAliases(mkdtempSync(join(tmpdir(), "extynt-resolve-")), () => true);
  const profile = profileOf(GLOW, GAUSSIAN, BOX);
  await resolveRequestTerms(serviceOver([scriptedChatModel(answerBox).model]).service, REQUEST, sourcesOf(profile, aliases));
  clearResolutions();
  const terms = await resolveRequestTerms(serviceOver([]).service, REQUEST, sourcesOf(profile, aliases));
  assert.deepEqual(terms.map((term) => term.band), ["learned", "learned"]);
});

test("an alias whose entry is no longer offered is not trusted, and the model is asked again", async () => {
  const aliases = new LearnedAliases(mkdtempSync(join(tmpdir(), "extynt-resolve-")), () => true);
  const chat = scriptedChatModel(answerBox);
  const { service } = serviceOver([chat.model]);
  await resolveRequestTerms(service, REQUEST, sourcesOf(profileOf(GLOW, GAUSSIAN, BOX), aliases));
  clearResolutions();
  const terms = await resolveRequestTerms(service, REQUEST, sourcesOf(profileOf(GLOW, GAUSSIAN, LENS), aliases));
  assert.equal(effectCalls(chat), 2);
  assert.equal(terms.some((term) => term.key === "ADBE Fast Box Blur"), false);
});

test("forgetting the aliases brings the model back", async () => {
  const aliases = new LearnedAliases(mkdtempSync(join(tmpdir(), "extynt-resolve-")), () => true);
  const chat = scriptedChatModel(answerBox);
  const { service } = serviceOver([chat.model]);
  const profile = profileOf(GLOW, GAUSSIAN, BOX);
  await resolveRequestTerms(service, REQUEST, sourcesOf(profile, aliases));
  forgetLearnedAliases(aliases);
  await resolveRequestTerms(service, REQUEST, sourcesOf(profile, aliases));
  assert.equal(effectCalls(chat), 2);
});
