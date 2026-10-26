// Keeps the tool and operation names the sidecar works with out of the words a reader sees.
import { executablePlanTypes } from "@extynt/capability-catalogue";
import { listTools } from "@extynt/mcp-server";

const PLACEHOLDER_PREFIX = /__new__:/g;
const FENCE = /(```[\s\S]*?```)/;
const NAME = /`?\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b`?/g;

const INTERNAL_WORDS: ReadonlyArray<readonly [RegExp, string]> = [[/\bbuild items\b/gi, "parts"], [/\bbuild item\b/gi, "part"], [/\breview items\b/gi, "checks"], [/\breview item\b/gi, "check"]];

const SENTENCE_END = /(?<=[.!?])\s+/;
const INTERNAL_COMPONENT = /\b(?:sidecar|orchestrator|decision tier)\b/i;

let known: { readonly tools: ReadonlySet<string>; readonly operations: ReadonlySet<string> } | undefined;

function names(): NonNullable<typeof known> {
  known ??= { tools: new Set(listTools().map((tool) => tool.name)), operations: new Set(executablePlanTypes()) };
  return known;
}

function plainName(match: string): string {
  const bare = match.replace(/`/g, "");
  if (names().tools.has(bare)) return "a step";
  return names().operations.has(bare) ? bare.replace(/_/g, " ") : match;
}

function withoutInternalSentences(line: string): string {
  const kept = line.split(SENTENCE_END).filter((sentence) => !INTERNAL_COMPONENT.test(sentence));
  return kept.join(" ");
}

function plainProse(text: string): string {
  const named = INTERNAL_WORDS.reduce((words, [term, plain]) => words.replace(term, plain), text).replace(PLACEHOLDER_PREFIX, "").replace(NAME, plainName);
  return named.split("\n").map(withoutInternalSentences).join("\n").replace(/\n{3,}/g, "\n\n");
}

/** The reply with placeholder prefixes dropped, real tool names turned into "a step" and real operation names into plain words; a sentence that names an internal component (the sidecar, the orchestrator, a decision tier) is dropped; fenced code and any other name stay as written. */
export function plainReply(text: string): string {
  return text.split(FENCE).map((part, index) => (index % 2 === 1 ? part : plainProse(part))).join("");
}
