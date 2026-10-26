// Runs one declared tool: refuses undeclared names, answers host-independent tools, then runs the snapshot tools after the layer-style fallback.
import type { ToolContext } from "./contracts.js";
import { jsonFieldsOf } from "./json.js";
import type { JsonObject } from "@extynt/decode";
import { reportLayerStyleCorrections, settleLayerStyles } from "./layer-style-fallback.js";
import { TOOL_DEFINITIONS } from "./tool-catalogue.js";
import { hostIndependentTool, snapshotTool } from "./tool-dispatch.js";
import { toolError } from "./tool-result.js";
import type { ToolResult } from "./tool-result.js";

const DECLARED_TOOLS: ReadonlySet<string> = new Set(TOOL_DEFINITIONS.map((definition) => definition.name));

/** The answer to a declared tool; a name that is not declared is refused before any context is read. */
export function callTool(name: string, args: JsonObject, context: ToolContext): ToolResult {
  if (!DECLARED_TOOLS.has(name)) return toolError(name.startsWith("ae_") ? "UNSUPPORTED_TOOL" : "INVALID_TOOL", "Only declared After Effects tools are available.");
  const early = hostIndependentTool(name, args, context);
  if (early) return early;
  const snapshot = context.snapshot;
  if (!snapshot) return toolError("NO_SNAPSHOT", "Refresh the After Effects snapshot before using this tool.");
  const settled = settleLayerStyles(name, args, context);
  if ("ok" in settled) return toolError(settled.error.code, settled.error.message);
  const base = { ok: true as const, tool: name, snapshotFingerprint: snapshot.fingerprint };
  return reportLayerStyleCorrections(snapshotTool({ name, args: jsonFieldsOf(settled.args), context, base, snapshot }), settled);
}
