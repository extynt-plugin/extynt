// Token-AND matching shared by every catalogue searcher: every query word must appear in one of a row's searchable values.

/** A row to search: `identity` are the names it is known by (for ranking), `fields` every value a token may match. */
export interface TokenSearchRow<T> {
  readonly identity: readonly (string | undefined)[];
  readonly fields: readonly (string | undefined)[];
  readonly item: T;
}

function lowercased(values: readonly (string | undefined)[]): string[] {
  return values.filter((value): value is string => typeof value === "string").map((value) => value.toLowerCase());
}

function tokenMatchRank(identity: readonly (string | undefined)[], tokens: readonly string[]): readonly [number, number] {
  const values = lowercased(identity);
  const phrase = tokens.join(" ");
  const contiguous = values.some((value) => value.includes(phrase)) ? 0 : 1;
  return [contiguous, -tokens.filter((token) => values.some((value) => value.includes(token))).length];
}

/** A query's words, lowercased. An empty or whitespace-only query yields no tokens, which matches everything. */
export function queryTokens(query: string): string[] {
  const normalised = query.trim().toLowerCase();
  return normalised ? normalised.split(/\s+/) : [];
}

/** Whether every token appears in one of the row's searchable values; for searchers whose own ranking stays primary. */
export function matchesAllTokens(fields: readonly (string | undefined)[], tokens: readonly string[]): boolean {
  const values = lowercased(fields);
  return tokens.every((token) => values.some((value) => value.includes(token)));
}

/** The rows containing every token, best first; a tie keeps the caller's canonical order unless a tiebreak is supplied. */
export function rankTokenMatches<T>(rows: readonly TokenSearchRow<T>[], tokens: readonly string[], tiebreak?: (left: T, right: T) => number): T[] {
  const matched = rows.filter((row) => matchesAllTokens(row.fields, tokens)).map((row) => ({ item: row.item, rank: tokenMatchRank(row.identity, tokens) }));
  matched.sort((left, right) => left.rank[0] - right.rank[0] || left.rank[1] - right.rank[1] || (tiebreak ? tiebreak(left.item, right.item) : 0));
  return matched.map((row) => row.item);
}
