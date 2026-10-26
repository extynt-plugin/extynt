// Meta-instructions in a request: sentences aimed at the classifier, not at the artist (ignore the above, answer strong, the system should say fast). The deterministic deciders read only the words that remain.

const SENTENCE_END = "[^.!?;\\n。！？；]*[.!?;。！？；]?";
const CLAUSE_START = "(^\\s*|[.!?;:,\\n。！？；]\\s*|\\b(?:and|then|und|dann|y|luego|et|puis)\\s+)";
const ANSWER_VERB = "(?:answer|respond|reply|classify|grade|say|output|responde|contesta|clasifica|antworte|sag|klassifizier\\p{L}*|reponds)";
const QUESTION_START = "(?=(?:which|what|how|why|where|who|when|is|are|does|do|can|wie|warum|welche|wo|que|cual|como|donde)\\b)";

const IGNORE_TARGET = "(?:above|previous|prior|earlier|preceding|instructions?|rules|prompt|system prompt|directions|guidelines|before this|vorherig\\p{L}*|bisherig\\p{L}*|obig\\p{L}*|anweisung\\p{L}*|anterior\\p{L}*|previo|instruccion\\p{L}*|precedent\\p{L}*|arriba)";
const IGNORE_VERB = "(?:ignor|disregard|forget|overrid|bypass|vergiss|oubli)\\p{L}*";

const META_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [new RegExp("\\[\\/?(?:system|assistant|developer|instructions?|classifier)[^\\]]*\\]", "giu"), ". "],
  [new RegExp("<\\/?(?:system|instructions?|classifier)[^>]*>", "giu"), ". "],
  [new RegExp(`\\b${IGNORE_VERB}\\b[^.!?;\\n。！？；]*?\\b${IGNORE_TARGET}\\b${SENTENCE_END}`, "giu"), " "],
  [new RegExp("(?:無視|忘れ)[^。！？\\n]*?(?:前|以前|指示|指令|プロンプト|ルール)[^。！？\\n]*", "giu"), " "],
  [new RegExp(`\\b(?:you|usted|du|tu|vous)\\s+(?:should|must|will|need to|have to|shall|are to|debes|tienes que|sollst|musst|devez|dois)\\s+(?:only\\s+|just\\s+|simply\\s+)?${ANSWER_VERB}\\b${SENTENCE_END}`, "giu"), " "],
  [new RegExp(`\\b(?:the (?:system|classifier|router|grader|decider|llm|assistant|ai)|el (?:sistema|clasificador)|das (?:system|klassifikator)|der (?:klassifikator|assistent))\\b[^.!?;\\n。！？；]{0,30}?\\b${ANSWER_VERB}\\b${SENTENCE_END}`, "giu"), " "],
  [new RegExp("\\b(?:correct|right|expected|proper|required|desired)\\s+(?:answer|label|output|response|tier|route|classification|category|decision)\\s+(?:is|should be|would be|must be)\\b[^.!?;\\n]*", "giu"), " "],
  [new RegExp("\\b(?:la (?:respuesta|clasificacion) correcta es|die (?:richtige|korrekte) (?:antwort|klassifikation) (?:ist|lautet))\\b[^.!?;\\n]*", "giu"), " "],
  [new RegExp("(?:正解|答え|正しい答え|正しい分類)は[^。！？\\n]*", "giu"), " "],
  [new RegExp("(?:答えて|答えろ|回答して|分類して|返答して)[^。！？\\n]*", "giu"), " "],
  [new RegExp("\\btreat (?:this|it|the request|the message|this request|this message|that) as\\b[^.!?;\\n]*", "giu"), " "],
  [new RegExp(`${CLAUSE_START}(?:answer|respond|reply|responde|contesta|antworte|reponds)\\s+${QUESTION_START}`, "giu"), "$1"],
  [new RegExp(`${CLAUSE_START}${ANSWER_VERB}\\b${SENTENCE_END}`, "giu"), "$1"],
  [new RegExp("(^|[.!?;]\\s*)(?:system|developer|assistant)\\s*:[^.!?;\\n]*", "giu"), "$1"],
];

/** The request text with every meta-instruction removed: an ignore-the-above, an answer or say order, a claim of the correct label, or a system tag, so that only what the user asks to be built is read. */
export function stripMetaInstructions(folded: string): string {
  return META_PATTERNS.reduce((text, [pattern, keep]) => text.replace(pattern, keep), folded);
}
