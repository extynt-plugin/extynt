// Reads the labelled decision fixtures from disk and decodes them: every file is checked against its decoder, so a typo in a fixture fails loudly.
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { FEATURE_IDS, controlCandidates, effectCandidates, fontRecords } from "@extynt/decide";
import type { DecisionImage, FeatureId } from "@extynt/decide";
import { array, boolean, decodeJson, literal, nullable, number, object, optional, rawJson, record, refine, string } from "@extynt/decode";
import type { Decoder, Infer, Shape } from "@extynt/decode";
import { REPO_ROOT } from "./repo-root.js";
import type { CaseTags } from "./decision-eval-types.js";

const FIXTURE_DIRECTORY = join(REPO_ROOT, "tools", "chat-tests", "fixtures", "decisions");

const featureId: Decoder<FeatureId> = refine(string(), (value): value is FeatureId => FEATURE_IDS.some((id) => id === value), "a feature id");

const TAGS = { id: string(), lang: optional(literal("en", "es", "de", "fr", "ja", "zh")), hard: optional(boolean()) };

/** Reads and decodes one fixture file. */
export function load<T>(name: string, decoder: Decoder<T>): T {
  const decoded = decodeJson(readFileSync(join(FIXTURE_DIRECTORY, name), "utf8"), decoder);
  if (!decoded.ok) throw new Error(`Fixture ${name} is malformed: ${decoded.error.message}`);
  return decoded.value;
}

/** A fixture file of tagged cases, each with the given fields. */
export function casesFile<S extends Shape>(name: string, shape: S) {
  return load(name, object({ description: string(), cases: array(object({ ...TAGS, ...shape })) }));
}

const IMAGE_DIRECTORY = join(FIXTURE_DIRECTORY, "images");

const MEDIA_TYPES: ReadonlyMap<string, string> = new Map([[".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"]]);

/** Reads a fixture png or jpeg (default `fixtures/decisions/images`) as the picture a case puts to image-capable models. */
export function loadFixtureImage(name: string, directory: string = IMAGE_DIRECTORY): DecisionImage {
  const mediaType = MEDIA_TYPES.get(extname(name).toLowerCase());
  if (mediaType === undefined) throw new Error(`Fixture image ${name} must be a png or jpeg file.`);
  return { mediaType, base64: readFileSync(join(directory, name)).toString("base64") };
}

/** The tags of a row: its language (English unless marked) and whether it is a hard case. */
export function tagsOf(row: { readonly lang?: CaseTags["lang"] | undefined; readonly hard?: boolean | undefined }): CaseTags {
  return { lang: row.lang ?? "en", hard: row.hard === true };
}

/** The effects installed in the fixture host. */
export function loadEffectCatalogue(): Infer<typeof effectCandidates> {
  return load("effects-catalogue.json", effectCandidates);
}

/** The font records installed in the fixture host. */
export function loadInstalledFonts(): Infer<typeof fontRecords> {
  return load("fonts-installed.json", fontRecords);
}

const effectRow = { phrase: string(), candidates: array(string()), wanted: nullable(string()) };
const habitRow = { phrase: string(), candidates: array(string()), habit: record(string(), number()), wanted: nullable(string()) };
const controlHabitRow = { effect: string(), phrase: string(), habit: record(string(), number()), wanted: nullable(string()) };
const controlRow = { effect: string(), phrase: string(), wanted: nullable(string()) };
const fontRow = { phrase: string(), wanted: nullable(string()) };
const partsRow = { request: string(), parts: array(featureId) };
const completionRow = { request: string(), applied: array(object({ type: string(), payload: rawJson() })), missing: array(featureId) };
const sceneRow = { request: string(), label: literal("drawn-scene", "arranged-layers") };
const namedRow = { request: string(), name: string(), asked: boolean() };
const styleRow = { message: string(), goal: string(), asked: boolean() };
const evidenceRow = { goal: string(), temporal: boolean(), visual: boolean(), judgement: boolean() };
const scaleRow = { request: string(), label: literal("small", "long") };
const continuationRow = { message: string(), label: literal("resume", "amend-and-resume", "new-request") };
const proseRow = { answer: string(), sealed: boolean(), failed: boolean(), askedUser: boolean(), refused: boolean(), expected: boolean() };
const answeredRow = { answer: string(), askedUser: boolean(), cycle: number(), continuation: boolean(), authoredWork: boolean(), expected: boolean() };
const waiverRow = {
  goal: string(), designed: boolean(), structuralOperations: boolean(), exactValuesOnly: boolean(), allConfirmed: boolean(), expected: boolean(),
};
const frameRow = {
  request: string(), width: number(), height: number(), level: number(), image: optional(string({ nonEmpty: true })),
  layers: array(object({ name: string(), text: boolean(), box: nullable(array(number())) })),
};
const claimRow = { message: string(), asserts: boolean() };
const modalRow = {
  matchName: string(), displayName: string(), hasOptionsDialog: nullable(boolean()),
  label: literal("opens-dialog", "analyzes-in-background", "may-ask-options", "no-dialog"),
};

/** The effect-pick cases: a phrase, a shortlist of match names and the wanted match name. */
export const loadEffectCases = () => casesFile("effect-resolution.json", effectRow);

/** The habit cases: an ambiguous phrase, the user's use counts and the wanted match name. */
export const loadHabitCases = () => casesFile("effect-habits.json", habitRow);

/** The control-resolution cases and the controls of each effect they draw on. */
export function loadControlCases() {
  return load("control-resolution.json", object({
    description: string(),
    effects: record(string(), object({ displayName: string(), controls: controlCandidates })),
    cases: array(object({ ...TAGS, ...controlRow })),
  }));
}

/** The control-habit cases: a phrase, the effect it is about, the user's use counts by control match name and the wanted match name. */
export function loadControlHabitCases() {
  return load("control-habits.json", object({
    description: string(),
    effects: record(string(), object({ displayName: string(), controls: controlCandidates })),
    cases: array(object({ ...TAGS, ...controlHabitRow })),
  }));
}

/** The font-matching cases. */
export const loadFontCases = () => casesFile("fonts.json", fontRow);

/** The request-parts cases. */
export const loadPartsCases = () => casesFile("request-parts.json", partsRow);

/** The completion cases. */
export const loadCompletionCases = () => casesFile("request-completion.json", completionRow);

/** The drawn-scene cases. */
export const loadSceneCases = () => casesFile("drawn-scene.json", sceneRow);

/** The named-object cases. */
export const loadNamedCases = () => casesFile("named-objects.json", namedRow);

/** The layer-style cases. */
export const loadStyleCases = () => casesFile("layer-style.json", styleRow);

/** The evidence-kind cases: one goal with its three labels. */
export const loadEvidenceCases = () => casesFile("evidence-kinds.json", evidenceRow);

/** The request-scale cases. */
export const loadScaleCases = () => casesFile("request-scale.json", scaleRow);

/** The continuation cases. */
export const loadContinuationCases = () => casesFile("continuation.json", continuationRow);

/** The ended-in-prose cases. */
export const loadProseCases = () => casesFile("ended-in-prose.json", proseRow);

/** The question-answered cases. */
export const loadAnsweredCases = () => casesFile("question-answered.json", answeredRow);

/** The visual-waiver cases. */
export const loadWaiverCases = () => casesFile("visual-waiver.json", waiverRow);

/** The frame-quality cases. */
export const loadFrameCases = () => casesFile("frame-quality.json", frameRow);

/** The modal-risk cases. */
export const loadModalCases = () => casesFile("modal-risk.json", modalRow);

/** The state-claim cases. */
export const loadClaimCases = () => casesFile("state-claim.json", claimRow);
