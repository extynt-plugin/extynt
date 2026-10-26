// Which project supplied each chat turn's observations, so a reply can link its sources without ever using the latest open project.
import { decode, jsonValue, literal, object, optional, union } from "@extynt/decode";

import type { ToolResult } from "./agent-types.js";
import { normalizeProjectFileLink, type ProjectFileLink } from "./project-file-names.js";

const MAX_TURNS = 32;
const MAX_LINKS_PER_TURN = 16;

const observation = object({
  state: union(literal("observed"), literal("retained")),
  invalidated: optional(jsonValue),
  storage: optional(object({ projectLink: optional(jsonValue) })),
});

function linkOf(result: ToolResult): ProjectFileLink | null {
  if (!result.ok) return null;
  const read = decode(observation, result.data);
  if (!read.ok || read.value.invalidated === true) return null;
  return normalizeProjectFileLink(read.value.storage?.projectLink);
}

/** Links describe which project supplied a turn's observations. They grant no graph freshness or write authority. */
export class ChatProjectLinks {
  private readonly turns = new Map<string, Map<string, ProjectFileLink>>();

  begin(requestId: string): void {
    this.turns.delete(requestId);
    this.turns.set(requestId, new Map());
    for (const oldest of this.turns.keys()) {
      if (this.turns.size <= MAX_TURNS) break;
      this.turns.delete(oldest);
    }
  }

  record(requestId: string, result: ToolResult): void {
    const turn = this.turns.get(requestId);
    const link = turn ? linkOf(result) : null;
    if (turn && link && (turn.has(link.stem) || turn.size < MAX_LINKS_PER_TURN)) turn.set(link.stem, link);
  }

  links(requestId: string): ProjectFileLink[] {
    return [...(this.turns.get(requestId)?.values() ?? [])];
  }
}
