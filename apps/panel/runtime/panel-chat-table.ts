/** GFM pipe tables in a reply: detected from the header and delimiter rows, drawn as a real table. */
import { el } from "./panel-dom.js";

type Align = "left" | "center" | "right" | null;
type Inline = (parent: HTMLElement, text: string) => void;

interface TableMatch {
  readonly header: ReadonlyArray<string>;
  readonly aligns: ReadonlyArray<Align>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  readonly last: number;
}

const DELIMITER_CELL = /^:?-+:?$/;

function cellsOf(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function alignOf(cell: string): Align {
  const start = cell.startsWith(":");
  const end = cell.endsWith(":");
  if (start && end) return "center";
  if (end) return "right";
  return start ? "left" : null;
}

function delimiterAt(line: string | undefined): Align[] | null {
  if (line === undefined || !line.includes("-") || !line.includes("|")) return null;
  const cells = cellsOf(line);
  return cells.every((cell) => DELIMITER_CELL.test(cell)) ? cells.map(alignOf) : null;
}

function rowAt(line: string | undefined): boolean {
  return line !== undefined && line.trim() !== "" && line.includes("|");
}

function fitted(cells: ReadonlyArray<string>, width: number): string[] {
  return Array.from({ length: width }, (_, index) => cells[index] ?? "");
}

/** The table that starts at `index`, or null when the line is not a header row followed by a delimiter row of the same width. */
export function tableAt(lines: ReadonlyArray<string>, index: number): TableMatch | null {
  if (!rowAt(lines[index])) return null;
  const aligns = delimiterAt(lines[index + 1]);
  const header = cellsOf(lines[index] ?? "");
  if (!aligns || aligns.length !== header.length) return null;
  const rows: string[][] = [];
  let last = index + 1;
  while (rowAt(lines[last + 1])) {
    last += 1;
    rows.push(fitted(cellsOf(lines[last] ?? ""), header.length));
  }
  return { header, aligns, rows, last };
}

function drawRow(section: HTMLElement, cells: ReadonlyArray<string>, context: { readonly tag: "th" | "td"; readonly aligns: ReadonlyArray<Align>; readonly inline: Inline }): void {
  const row = el("tr");
  cells.forEach((text, column) => {
    const align = context.aligns[column];
    const cell = el(context.tag, align ? `md-align-${align}` : "");
    context.inline(cell, text);
    row.appendChild(cell);
  });
  section.appendChild(row);
}

/** Draws the table into `parent` in a wrapper that wraps long cells instead of scrolling. */
export function appendTable(parent: HTMLElement, table: TableMatch, inline: Inline): void {
  const wrap = el("div", "md-table-wrap");
  const grid = el("table", "md-table");
  const head = el("thead");
  const body = el("tbody");
  drawRow(head, table.header, { tag: "th", aligns: table.aligns, inline });
  for (const row of table.rows) drawRow(body, row, { tag: "td", aligns: table.aligns, inline });
  grid.appendChild(head);
  grid.appendChild(body);
  wrap.appendChild(grid);
  parent.appendChild(wrap);
}
