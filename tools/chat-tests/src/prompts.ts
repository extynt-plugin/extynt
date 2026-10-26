/**
 * The prompt library: one markdown file per prompt, under `prompts/`. A prompt is authored
 * prose, so it lives in a file a person can write and diff, and adding one needs no edit here.
 * Format: front matter between `---` fences, then the prompt verbatim. `expect` is one line of
 * JSON rather than nested YAML, which keeps this parser small enough to trust.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPOSITION_ASSETS } from "./assets.js";
import { isKnownFact } from "./project-facts.js";
import { array, decodeJson } from "@extynt/decode";
import { expectationOf, type ScenarioExpectation } from "./scenario-expectation.js";
import type { Scenario } from "./scenarios.js";
import { stringList } from "./string-list.js";

/** Resolved from this module rather than the cwd, so the CLI works from anywhere. */
export const PROMPTS_DIRECTORY = fileURLToPath(new URL("../../prompts/", import.meta.url));
const TURN_SEPARATOR = /\n[ \t]*--- next turn ---[ \t]*\n/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

type FrontMatter = ReadonlyMap<string, string>;

/** A prompt file parsed into its scenario. */
export interface LoadedPrompt {
  scenario: Scenario;
  path: string;
}

/** Every `*.md` file in the prompt directory, in filename order; a missing directory is an empty library. */
export function loadPrompts(directory: string = PROMPTS_DIRECTORY): LoadedPrompt[] {
  if (!existsSync(directory)) return [];
  const prompts: LoadedPrompt[] = [];
  const seen = new Map<string, string>();
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".md")).sort()) {
    const path = join(directory, name);
    const { scenario } = parsePrompt(readFileSync(path, "utf8"), path);
    const previous = seen.get(scenario.id);
    if (previous) throw new Error(`${path}: scenario id "${scenario.id}" is already defined by ${previous}.`);
    seen.set(scenario.id, path);
    prompts.push({ scenario, path });
  }
  return prompts;
}

/** Parses one prompt file's text into a scenario, throwing with `path` and the reason when it is malformed. */
export function parsePrompt(text: string, path = "(prompt)"): { scenario: Scenario } {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) throw new Error(`${path}: a prompt must open with a "---" front-matter fence.`);
  const end = normalized.indexOf("\n---", 3);
  if (end < 0) throw new Error(`${path}: the front matter is never closed with a "---" fence.`);
  const frontMatter = parseFrontMatter(normalized.slice(4, end), path);
  const [message = "", ...followUps] = normalized.slice(end + 4).replace(/^\n+/, "").trimEnd().split(TURN_SEPARATOR).map((turn) => turn.trim());
  const id = promptId(frontMatter, path);
  const asset = promptAsset(frontMatter, path);
  if (!message) throw new Error(`${path}: the prompt body is empty.`);
  return { scenario: scenarioOf({ id, asset, message, followUps }, frontMatter, path) };
}

interface PromptParts { id: string; asset: string; message: string; followUps: string[] }

function scenarioOf(parts: PromptParts, frontMatter: FrontMatter, path: string): Scenario {
  const notes = frontMatter.get("notes");
  return {
    id: parts.id,
    asset: parts.asset,
    offline: frontMatter.get("offline") === "true",
    message: parts.message,
    ...(parts.followUps.length ? { followUps: parts.followUps } : {}),
    ...parseFacts(frontMatter.get("facts"), path),
    expect: parseExpectation(frontMatter.get("expect"), path),
    ...(notes ? { notes } : {}),
  };
}

function promptId(frontMatter: FrontMatter, path: string): string {
  const declared = frontMatter.get("id");
  const id = declared ?? slugify(basename(path).replace(/\.md$/, ""));
  if (ID_PATTERN.test(id)) return id;
  throw new Error(declared
    ? `${path}: id "${id}" must be lowercase letters, digits, and dashes.`
    : `${path}: a name of "${basename(path)}" yields no usable id; add an "id:" field.`);
}

function promptAsset(frontMatter: FrontMatter, path: string): string {
  const asset = frontMatter.get("asset");
  const known = Object.keys(COMPOSITION_ASSETS).join(", ");
  if (!asset) throw new Error(`${path}: "asset" is required (one of ${known}).`);
  if (!Object.hasOwn(COMPOSITION_ASSETS, asset)) throw new Error(`${path}: unknown asset "${asset}". Known: ${known}.`);
  return asset;
}

function parseFrontMatter(block: string, path: string): FrontMatter {
  const fields = new Map<string, string>();
  for (const [index, line] of block.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const at = trimmed.indexOf(":");
    if (at < 1) throw new Error(`${path}: front-matter line ${index + 1} is not "key: value": ${JSON.stringify(line)}`);
    fields.set(trimmed.slice(0, at).trim(), trimmed.slice(at + 1).trim());
  }
  return fields;
}

const factsOf = array(stringList);

function parseFacts(value: string | undefined, path: string): { facts?: string[][] } {
  if (!value) return {};
  const decoded = decodeJson(value, factsOf);
  if (!decoded.ok && decoded.error.expected === "valid JSON text") throw new Error(`${path}: "facts" must be one line of JSON.`);
  if (!decoded.ok || !decoded.value.every((turn) => turn.every(isKnownFact))) throw new Error(`${path}: "facts" must be a list with one list of known project facts per turn.`);
  return { facts: decoded.value.map((turn) => [...turn]) };
}

function parseExpectation(value: string | undefined, path: string): ScenarioExpectation {
  if (!value) return {};
  const decoded = decodeJson(value, expectationOf);
  if (!decoded.ok) throw new Error(`${path}: "expect" must be one line of JSON (${decoded.error.message}).`);
  return decoded.value;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}
