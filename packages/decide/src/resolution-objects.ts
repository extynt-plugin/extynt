// Finds the object of a request's action ("pixelate the face"): the noun phrase after a look or action word and its determiner, which names what is changed rather than how.
const DETERMINERS: ReadonlySet<string> = new Set((
  "the a an this that these those my your its their our his her " +
  "el la los las un una der die das ein eine le les une " +
  "il lo gli uno"
).split(" "));

const GENITIVE_ARTICLES: ReadonlySet<string> = new Set(["der"]);

const PREPOSITION_BEFORE: ReadonlySet<string> = new Set(["partir"]);

const BOUNDARY_WORDS: ReadonlySet<string> = new Set((
  "of on in at to for from with by and or but as into onto over under up down off than then while if when " +
  "de del con para por y o en al sobre mit von zu fur auf aus bei und oder avec pour dans sur"
).split(" "));

function markObject(words: ReadonlyArray<string>, start: number, actionWords: ReadonlySet<string>, flags: boolean[]): void {
  for (let next = start; next < words.length; next += 1) {
    const token = words[next] ?? "";
    if (BOUNDARY_WORDS.has(token) || DETERMINERS.has(token) || (next > start && actionWords.has(token))) return;
    flags[next] = true;
  }
}

/** For each word, whether it is part of the object of an action: the words after a determiner that follows an action word, up to a boundary, a determiner or a later action word; a word of the keep set is never one. */
export function objectFlags(words: ReadonlyArray<string>, actionWords: ReadonlySet<string>, keep: ReadonlySet<string> = new Set()): ReadonlyArray<boolean> {
  const flags = words.map(() => false);
  words.forEach((word, index) => {
    if (DETERMINERS.has(word) && !GENITIVE_ARTICLES.has(word) && !PREPOSITION_BEFORE.has(words[index + 1] ?? "") && index > 0 && actionWords.has(words[index - 1] ?? "")) markObject(words, index + 1, actionWords, flags);
  });
  return flags.map((flag, index) => flag && !keep.has(words[index] ?? ""));
}
