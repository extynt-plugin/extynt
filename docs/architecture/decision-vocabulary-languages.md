# Decision vocabulary in six languages

The deterministic decision tier (`packages/decide/src`) reads English, Spanish (es), German (de), French (fr),
Japanese (ja) and Simplified Chinese (zh). There is no language detection and no per-language table: every word table
holds words of any language side by side, and every matcher folds text and words the same way.

## The convention

**A row carries its words in any language, in one list.** Order within a row is `en, es, de, fr, ja, zh`, so a reviewer
sees at a glance which language is missing. Rows are never duplicated per language, and a language never gets its own
file. To add a language to an existing meaning, append its words to the existing row.

| Table kind | Where | How a row carries words |
| --- | --- | --- |
| Concept rows (effects, properties/controls, fonts) | `resolution-effect-words-*.ts`, `resolution-attribute-words*.ts`, `resolution-font-words*.ts` (type `ConceptRow` in `resolution-concepts.ts`) | `[words, targets, weight, prefer?]`; `words` is one comma-separated string of words in any language |
| Phrase lists (request parts, route, specialists, drawn scene) | `request-vocabulary.ts`, `request-specialist-cues.ts`, `drawn-scene.ts`, `request-concepts.ts` | an array of phrases, or a `phraseRegex([...])` call, any language in the same array |
| Approval-first request (show the design first, wait for a go-ahead) | `request-approval-words.ts`, `request-approval.ts` | one phrase list per language, so the match also names the language; refusals such as "no need to wait" go through `REQUEST_LEXICON` |
| Roots (evidence) | `evidence-words.ts`, `evidence-concept-tables.ts`, `evidence-continuation.ts` | an array of roots passed to `mentions` / `hasWord`, any language |
| Negation and clause words | `resolution-clause-words.ts` (concept matching), `request-vocabulary.ts` (`REQUEST_LEXICON`) | negators and clause breaks of all six languages in one set or regex |

Targets (the name stems after the words) are English stems of After Effects names and never change per language.
Do not add a language field, a locale key or a second row for a translation.

When a file reaches the 400-line gate, move rows to a sibling file named for the topic (not the language) and register
it where its siblings are registered (`resolution-effects.ts` for effects, and so on).

## How text is folded

All three matching stacks fold through `text-folding.ts`; fold once, never re-implement it.

- `foldLetters`: NFKC, so full-width letters and digits and half-width katakana become plain ones (`ＢＬＵＲ` is
  `BLUR`, `ｶﾞｳｽ` is `ガウス`, `，` is `,`); accents removed from Latin letters (`é ñ ü ç`); `ß` is `ss`, `œ` is `oe`,
  `æ` is `ae`, `ø` is `o`.
- `normaliseText` (`resolution-text.ts`, concept tables) adds lower case, French elision splitting (`l'ombre` is
  `l ombre`, `d'image` is `d image`, `qu'il` is `qu il`) and drops other apostrophes (`don't` is `dont`).
- `foldRequest` (`request-text.ts`, phrase lists) adds `n't` as `not` and line breaks as sentence breaks.
- `foldText` (`evidence-words.ts`, roots) adds lower case and turns punctuation into spaces.

Because words are folded as the text is, **write words naturally**: `prüfe`, `schärfer`, `Weichzeichner`, `flou`,
`œuvre` are fine in a table and match `prufe` and `scharfer`; `schaerfer` does not (see pitfalls).

## Matching rules

Latin words (es, de, fr and English):

- A concept word matches at the start of a word: `weichzeichn` matches `Weichzeichner`. A word of 4 or more letters
  needs only the start; a shorter word must be a whole word. A word of 6 or more letters also matches anywhere inside a
  longer word, which is what finds German compounds (`Gaußweichzeichner`, `Schlagschatten`).
- **Compounds shorter than 6 letters**: write the word with a leading `~` (`~kante`, `~leucht`). It then matches
  anywhere inside a word. In a concept row it is compiled into the concept's `compounds`; in a phrase list `~` means a
  fragment and in an evidence root it means the same. Use `~` only for words that are safe inside other words.
- Multi-word concept words (`depth of field`, `profondeur de champ`) tolerate one article between words
  (`the/a/le/une/der/ein/el/la` and their forms).
- Phrase lists: `word` is a word start, `=word` a whole word only (use it for short words such as `=ni`, `=et`, `=pas`),
  `~word` a fragment. Phrases fold their own accents.
- French elisions are split before concept matching, so write the bare word (`ombre`, `image`, `effet`), never `l'ombre`.
- Negation: a Latin negator (`no not without sin nunca ohne kein* nicht nie sans pas jamais aucun*`) denies the 3 words
  after it. A Latin concept or phrase after it is denied. `ne ... pas` is read through `pas`.

Japanese and Chinese (no spaces, no word segmentation):

- Any word containing a kana or an ideograph (CJK Unified Ideographs, U+3400 to U+9FFF) is matched as a plain
  **substring** of the folded clause, in concept rows, phrase lists and roots. There are no word edges, so choose words
  specific enough to be safe inside other words (`影` in `陰影`/`阴影` is a hit for both).
- **Katakana words also match hiragana text** (`ボケ` matches `ぼけ`, `ブラー` matches `ぶらー`) but a hiragana word
  matches only hiragana. The reverse is deliberately not done: it made `どう` ("how") match inside `ドロップシャドウ`.
- Half-width and full-width forms are the same word. Traditional characters are not folded; write Simplified Chinese
  only.
- A clause is denied as a whole when it holds `なし ない 不要 抜き 外して` (ja) or `不要 不用 不需要 不带 不加 没有 去掉 去除
  无需 避免` (zh). Clauses end at `、 。` and `しかし けど でも 但是 可是 不过 然而`, as well as `, ; . :` (full-width
  ones are folded to these). Prefer phrasing the table words as the affirmative noun (`ぼかし`, `模糊`) and let the clause
  logic handle the denial.

## Pitfalls

- `ae`, `oe`, `ue` spellings of German umlauts (`schaerfer`) are not folded: folding them would break English
  (`blue`, `does`). If they matter, add that spelling as its own word in the row.
- Never write elisions (`l'`, `d'`, `qu'`) or curly apostrophes in a French word.
- Never put a hiragana particle or a one-ideograph grammar word in a table (`の`, `を`, `不`, `的`): substring matching
  fires everywhere. `不` alone is inside `不透明度` (opacity); that is why zh negation uses compounds.
- Short Latin words that are common in another language collide (`die`, `an`, `pas`, `sin`, `ni`, `en`, `et`, `y`): use
  `=word` in phrase lists, and in concept rows remember that a word under 4 letters is whole-word only.
- A very long compound `~` fragment can still hit unrelated words; test the fragment against English requests.
- Do not add comments inside tables or function bodies (gate); the `en, es, de, fr, ja, zh` order is the only
  documentation a row has.
- Every new word needs a test row: add it to the suite fixtures in `tools/chat-tests/fixtures/decisions/` with
  `"lang": "fr"` (or `es`, `de`, `ja`, `zh`) so the eval reports the language; unit tests for the folding rules are in
  `packages/decide/tests/language-matching.test.ts`.

## Checking a change

```
pnpm exec tsc -b
node tools/chat-tests/dist/src/decision-eval.js --stress
node scripts/run-tests.ts packages/decide/dist/tests/*.test.js
```

The eval prints per-language deterministic accuracy for every suite (`non-en det>routed`); a table change must not lower
any English or existing-language figure.
