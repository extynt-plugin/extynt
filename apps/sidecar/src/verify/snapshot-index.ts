// Constant-time lookups of compositions, layers, items and properties in a decoded snapshot, built once per list the first time it is searched.
interface HasId {
  readonly id: string;
}
interface HasPath {
  readonly path?: string | undefined;
}

const idPositions = new WeakMap<ReadonlyArray<HasId>, ReadonlyMap<string, number>>();
const pathPositions = new WeakMap<ReadonlyArray<HasPath>, ReadonlyMap<string, number>>();

function positionsOf<T>(rows: ReadonlyArray<T>, keyOf: (row: T) => string | undefined): ReadonlyMap<string, number> {
  const positions = new Map<string, number>();
  rows.forEach((row, position) => {
    const key = keyOf(row);
    if (key !== undefined && !positions.has(key)) positions.set(key, position);
  });
  return positions;
}

function cachedPositions<T extends HasId | HasPath>(cache: WeakMap<ReadonlyArray<T>, ReadonlyMap<string, number>>, rows: ReadonlyArray<T>, keyOf: (row: T) => string | undefined): ReadonlyMap<string, number> {
  const known = cache.get(rows);
  if (known) return known;
  const built = positionsOf(rows, keyOf);
  cache.set(rows, built);
  return built;
}

function rowAt<T>(rows: ReadonlyArray<T>, position: number | undefined): T | null {
  return position === undefined ? null : (rows[position] ?? null);
}

/** The first row whose id is `id`, or null; the list is indexed on first use and the index is dropped with the list. */
export function findById<T extends HasId>(rows: ReadonlyArray<T> | undefined, id: string | undefined): T | null {
  if (!rows || id === undefined) return null;
  return rowAt(rows, cachedPositions(idPositions, rows, (row) => row.id).get(id));
}

/** The first row whose property path is `path`, or null; the list is indexed on first use and the index is dropped with the list. */
export function findByPath<T extends HasPath>(rows: ReadonlyArray<T> | undefined, path: string | undefined): T | null {
  if (!rows || path === undefined) return null;
  return rowAt(rows, cachedPositions(pathPositions, rows, (row) => row.path).get(path));
}
