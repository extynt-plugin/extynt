// Groups raw comments into blocks and reports where a block sits relative to the code around it.

/** One comment found in a source: its offsets, lines, whether it owns its line, whether it may join a neighbour, and its text. */
export interface SourceComment {
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly endLine: number;
  readonly ownLine: boolean;
  readonly joinable: boolean;
  readonly text: string;
}

/** What a shell or PowerShell scan finds: every comment, and the lines that begin in plain code. */
export interface ScriptScan {
  readonly comments: ReadonlyArray<SourceComment>;
  readonly codeLines: ReadonlySet<number>;
}

/** Merges comments on adjacent lines that each own their line (a run of `//` or `#` lines) into one block. */
export function groupBlocks(comments: ReadonlyArray<SourceComment>): ReadonlyArray<SourceComment> {
  const blocks: SourceComment[] = [];
  for (const comment of comments) {
    const last = blocks.at(-1);
    const joins = last !== undefined && last.joinable && comment.joinable && comment.ownLine && comment.line === last.endLine + 1;
    if (joins) blocks[blocks.length - 1] = { ...last, endLine: comment.endLine, end: comment.end, text: `${last.text}\n${comment.text}` };
    else blocks.push({ ...comment });
  }
  return blocks;
}

/** Builds a failure line for a block. */
export function blockFailure(key: string, block: SourceComment, reason: string): string {
  return `${key}:${block.line}: ${reason}`;
}

/** True when a block ends on the line directly above the given line and starts its own line. */
export function isDirectlyAbove(block: SourceComment, line: number): boolean {
  return block.ownLine && block.endLine + 1 === line;
}
