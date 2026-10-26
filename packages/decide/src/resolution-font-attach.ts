// Which words of a font request sit apart from the family name it holds: a word with a small word between it and the name ("Lato for the lower third captions") is phrasing, a word right beside the name ("Arial Unicode") may belong to it.
const BREAK = "|";

/** The words of a request in order, each kept when it is a name word and replaced by a break otherwise (small words, clause ends). */
export function sequenceOf(clauses: ReadonlyArray<{ readonly words: ReadonlyArray<string> }>, tokens: ReadonlySet<string>): ReadonlyArray<string> {
  return clauses.flatMap((clause) => [BREAK, ...clause.words.map((word) => (tokens.has(word) ? word : BREAK))]);
}

function reach(sequence: ReadonlyArray<string>, from: number, step: number): ReadonlyArray<string> {
  const near: string[] = [];
  for (let at = from + step; sequence[at] !== undefined && sequence[at] !== BREAK; at += step) near.push(sequence[at] ?? BREAK);
  return near;
}

/** The words of the request that are in it but not beside a matched word (runs of name words touching it, either side), which phrase the request and do not extend the name. */
export function detachedWords(sequence: ReadonlyArray<string>, matched: ReadonlySet<string>): ReadonlySet<string> {
  const beside = new Set<string>();
  sequence.forEach((word, index) => {
    if (!matched.has(word)) return;
    for (const near of [...reach(sequence, index, 1), ...reach(sequence, index, -1)]) beside.add(near);
  });
  return new Set(sequence.filter((word) => word !== BREAK && !matched.has(word) && !beside.has(word)));
}
