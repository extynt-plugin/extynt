/** Number, size and table formatting for the native-spike output. */

/** Milliseconds with two decimals, one from 100 up; "-" when absent. */
export function fmtMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return value >= 100 ? value.toFixed(1) : value.toFixed(2);
}

/** A rounded integer; "-" when absent. */
export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return String(Math.round(value));
}

/** Bytes in B, KiB or MiB; "-" when absent. */
export function fmtBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  if (value >= 1048576) return `${(value / 1048576).toFixed(2)} MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${Math.round(value)} B`;
}

/** Renders rows (arrays of strings) under a header; the first column is left-aligned, the rest right-aligned. */
export function formatTable(header: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>): string {
  const all = [header, ...rows];
  const widths = header.map((_, column) => Math.max(...all.map((row) => String(row[column]).length)));
  const line = (row: ReadonlyArray<string>) => row.map((cell, column) => (column === 0 ? String(cell).padEnd(widths[column] ?? 0) : String(cell).padStart(widths[column] ?? 0))).join("  ").trimEnd();
  const rule = widths.map((width) => "-".repeat(width)).join("  ");
  return [line(header), rule, ...rows.map(line)].join("\n");
}
