// Request names and layer styles: the UPPER_SNAKE names a request gives its layers, and whether it names Layer Styles.
import { binary } from "./spec.js";
import type { BinarySpec } from "./spec.js";
import { asksFor, foldRequest, refusedAt } from "./request-text.js";
import { LAYER_STYLE_PATTERN, REQUEST_LEXICON } from "./request-vocabulary.js";
import { cjkReading, latinReading } from "./request-name-reading.js";
import { CJK_NEGATION, CLAUSE_BREAK } from "./resolution-clause-words.js";

/** What the named-object decision reads: the request and one UPPER_SNAKE name found in it. */
export type NameInRequest = { readonly request: string; readonly name: string };

/** What the layer-style decision reads: the turn's message and the job's goal so far ("" when there is none). */
export type StyleRequest = { readonly message: string; readonly goal: string };

const NAMED_OBJECT = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9]\b/gu;
const NATIVE_NAME_PREFIX = "ADBE_";

/** The UPPER_SNAKE names found in a request, once each in order of appearance: the candidates the named-object question is asked about. */
export function namedObjectCandidates(request: string): ReadonlyArray<string> {
  return [...new Set([...foldRequest(request).matchAll(NAMED_OBJECT)].map((match) => match[0]))];
}

type NameReading = { readonly name: string; readonly made: boolean };

function readNames(text: string): ReadonlyArray<NameReading> {
  const refused = refusedAt(text, REQUEST_LEXICON);
  return [...text.matchAll(NAMED_OBJECT)].reduce<ReadonlyArray<NameReading>>((read, match) => {
    const at = match.index ?? 0;
    const cjk = cjkReading(text.slice(0, at), text.slice(at + match[0].length));
    const governed = cjk === undefined ? latinReading(text.slice(0, at), read.at(-1)?.made ?? false) : cjk === "create";
    return [...read, { name: match[0], made: governed && !match[0].startsWith(NATIVE_NAME_PREFIX) && !refused(at) }];
  }, []);
}

/** The UPPER_SNAKE names a request asks the artist to create or to rename to: only a name that a create or naming word governs. Native ADBE_ match names, names a refusal reaches, edit targets, names said to exist already and past context are not asked. */
export function namedObjectsAsked(request: string): ReadonlyArray<string> {
  return [...new Set(readNames(foldRequest(request)).filter((read) => read.made).map((read) => read.name))];
}

/** Whether the request tells the artist to build a layer or composition with exactly this name (and not an After Effects internal name, a negated mention or a passing reference). */
export const NAMED_OBJECT_ASKED: BinarySpec<NameInRequest> = binary<NameInRequest>({
  name: "named-object",
  instructions: "A motion designer's request may give exact names, written in capitals with underscores, for layers or compositions to create. Decide whether the request requires an object with exactly the name in the state to exist.",
  criteria: {
    true: "The request tells the artist to create a layer or composition with exactly this name, so the project must contain it.",
    false: "The name is an After Effects internal name, is mentioned only in passing or as something that already exists, or the request rules it out.",
  },
  deterministic: (state) => namedObjectsAsked(state.request).includes(state.name),
});

const CJK_REFUSAL = new RegExp(`${CJK_NEGATION.source}|使わず|使用せず|せずに|やめ|避け|別の|ではなく|じゃなく|别用|别使用|而不是|换成`, "u");

const CJK_TEXT = /[぀-ヿ一-鿿]/u;

function styleDeniedInCjk(text: string): boolean {
  const clauses = text.split(CLAUSE_BREAK).filter((clause) => CJK_TEXT.test(clause) && new RegExp(LAYER_STYLE_PATTERN.source, "u").test(clause));
  return clauses.length > 0 && clauses.every((clause) => CJK_REFUSAL.test(clause));
}

/** Whether the user names Layer Styles, so that a plain drop shadow or glow effect is not what they asked for; any language. */
export const LAYER_STYLE_REQUEST: BinarySpec<StyleRequest> = binary<StyleRequest>({
  name: "layer-style-request",
  instructions: "A motion designer's message, with the job's goal so far, may ask for After Effects Layer Styles (the Layer > Layer Styles menu: Drop Shadow, Inner Glow, Stroke and so on), which are different from effects of the same name. The message may be in any language; the feature name may be translated (for example the German Ebenenstile or the Japanese レイヤースタイル).",
  criteria: {
    true: "The message or the goal asks for Layer Styles by name or by describing the Layer Styles feature.",
    false: "It asks for a shadow, glow or stroke without naming Layer Styles, or asks for neither.",
  },
  deterministic: (state) => {
    const text = foldRequest(`${state.goal}. ${state.message}`);
    return asksFor(text, LAYER_STYLE_PATTERN, REQUEST_LEXICON) && !styleDeniedInCjk(text);
  },
});
