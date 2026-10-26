// The two effect-notes tools, one path for the external MCP surface and the in-panel agent; notes are never a project write.
import type { JsonValue } from "@extynt/decode";
import type { ToolPayload } from "./agent-types.js";
import { jsonOf, type callTool } from "@extynt/mcp-server";
import type { EffectNotesService } from "./effect-notes-service.js";
import type { NoteFailure } from "./effect-notes-types.js";

type ToolResult = ReturnType<typeof callTool>;

/** The tool names this module answers. */
export const EFFECT_NOTES_TOOLS = new Set(["ae_read_effect_notes", "ae_write_effect_note"]);

function failure(refusal: NoteFailure): ToolResult {
  const error = { code: refusal.code, message: refusal.message, ...(refusal.cap ? { cap: refusal.cap } : {}), ...(refusal.current ? { current: refusal.current } : {}), writeAuthorizing: false };
  return { ok: false, error };
}

function success(tool: string, data: ToolPayload): ToolResult {
  return { ok: true, tool, snapshotFingerprint: null, data };
}

/** Runs one notes tool; refusals carry the current notes (stale, cap and replace refusals) so the model retries without another read. */
export function runEffectNotesTool(service: EffectNotesService, name: string, args: JsonValue): ToolResult {
  if (name === "ae_read_effect_notes") {
    const read = service.read(args);
    return read.ok ? success(name, jsonOf(read)) : failure(read);
  }
  if (name !== "ae_write_effect_note") return { ok: false, error: { code: "UNKNOWN_EFFECT_NOTES_TOOL", message: "No effect notes tool exists under this name." } };
  const written = service.write(args);
  return written.ok ? success(name, jsonOf(written)) : failure(written);
}
