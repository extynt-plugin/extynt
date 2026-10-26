// The queue's fix list: refusals grouped by fault, with each consequence filed under the fault that caused it.

/** The row a rejected verdict contributes to the fix list, after the chunk offset is applied. */
export type FixRow = { index: number; type?: string; status: string; code?: string; detail?: string; fix?: string; consequenceOf?: number };

type FixConsequence = { positions: number[]; type?: string; code?: string; message: string };

type FixEntry = {
  position: number;
  positions: number[];
  type?: string;
  code?: string;
  message: string;
  instruction?: string;
  consequences?: FixConsequence[];
};

type FixGroup = { entry: FixEntry; cause?: number };

function fixGroupKey(row: FixRow): string {
  return [row.consequenceOf ?? "root", row.type ?? "", row.code ?? "", row.detail ?? ""].join("\u0000");
}

function fixEntryOf(row: FixRow): FixEntry {
  return {
    position: row.index,
    positions: [row.index],
    ...(row.type ? { type: row.type } : {}),
    ...(row.code ? { code: row.code } : {}),
    message: row.detail ?? "",
    ...(row.fix ? { instruction: row.fix } : {}),
  };
}

function groupFixRows(rows: readonly FixRow[]): Map<string, FixGroup> {
  const groups = new Map<string, FixGroup>();
  for (const row of rows.filter((candidate) => candidate.status === "rejected")) {
    const held = groups.get(fixGroupKey(row));
    if (held) held.entry.positions.push(row.index);
    else groups.set(fixGroupKey(row), { entry: fixEntryOf(row), ...(row.consequenceOf === undefined ? {} : { cause: row.consequenceOf }) });
  }
  return groups;
}

function consequenceOf(entry: FixEntry): FixConsequence {
  return { positions: entry.positions, ...(entry.type ? { type: entry.type } : {}), ...(entry.code ? { code: entry.code } : {}), message: entry.message };
}

/** The fix list as the next step needs it: one entry per fault, not per operation. */
export function fixEntries(rows: readonly FixRow[]): FixEntry[] {
  const groups = [...groupFixRows(rows).values()];
  const roots = groups.filter((group) => group.cause === undefined).map((group) => group.entry);
  const rootAt = new Map(roots.flatMap((root) => root.positions.map((position): [number, FixEntry] => [position, root])));
  const unattached: FixEntry[] = [];
  for (const { entry, cause } of groups.filter((group) => group.cause !== undefined)) {
    const root = cause === undefined ? undefined : rootAt.get(cause);
    if (!root) unattached.push(entry);
    else root.consequences = [...(root.consequences ?? []), consequenceOf(entry)];
  }
  return [...roots, ...unattached].sort((left, right) => left.position - right.position);
}
