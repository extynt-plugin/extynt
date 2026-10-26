// The words that cut a request into clauses and deny what a clause names, in English, Spanish, German, French, Japanese and Simplified Chinese.

/** Words that deny the few words after them; a Latin word of any language, folded the way normaliseText folds it. */
export const NEGATORS: ReadonlySet<string> = new Set([
  "no", "not", "without", "never", "dont", "doesnt", "sin", "nunca", "ni", "ohne", "kein", "keine", "keinen", "keinem", "keiner", "keines", "nicht", "nie", "niemals",
  "sans", "pas", "jamais", "aucun", "aucune",
]);

/** Spans in a CJK clause that deny the whole clause: Japanese ない, なし, 不要, and Chinese 不要, 不用, 没有, 去掉. */
export const CJK_NEGATION = /なし|無し|ない|不要|(?<!切り|くり)抜き|いらな|外して|不用|不需要|不带|不加|没有|去掉|去除|无需|避免/u;

/** The Chinese denial spans that remain once the removal verbs 去掉 and 去除 are set aside: a concept spelled with a removal verb is a removal ("去除划痕"), which those verbs ask for instead of deny. */
export const CJK_NEGATION_BESIDES_REMOVAL = /なし|無し|ない|不要|(?<!切り|くり)抜き|いらな|外して|不用|不需要|不带|不加|没有|无需|避免/u;

/** The Chinese removal verbs. */
export const CJK_REMOVAL_VERB = /去掉|去除/u;

/** Where a clause ends: punctuation, a Latin conjunction of contrast, or a Japanese or Chinese one (しかし, けど, 但是, 不过). */
export const CLAUSE_BREAK = /[,;.:]| (?:but|aber|pero|sino|sondern|mais|however) |pero$|、|。|しかし|けれど|けど|だが|でも|但是|可是|不过|然而/u;
