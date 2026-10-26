// The result of one MCP tool call as the mcp-server package answers it, with what the sidecar adds beside it.
import type { StoredPlan, ToolFailure, ToolResult } from "@extynt/mcp-server";

interface SealedCard {
  readonly planId: string;
  readonly presentation: NonNullable<StoredPlan["presentation"]> | null;
  readonly plan: StoredPlan["plan"];
  readonly summary: string;
}

interface McpAdditions {
  warning?: string;
  focusNote?: string;
  sealedCard?: SealedCard;
}

type Settable<Shape> = { -readonly [Field in keyof Shape]: Shape[Field] };

/** A tool's successful result, as `callTool` answers it, with the fields the sidecar sets on it before it is delivered. */
export type McpSuccess = Omit<Settable<Extract<ToolResult, { ok: true }>>, "data"> & McpAdditions & { data: ToolData };

/** A tool's result, as `callTool` answers it, with the sidecar's additions. */
export type McpResult = McpSuccess | (ToolFailure & McpAdditions);

/** The data of a tool result: JSON whose objects the sidecar may add fields to before it delivers them. */
export type ToolData = null | boolean | number | string | readonly ToolData[] | ToolFields;

/** An object in a tool result's data. */
export interface ToolFields {
  [field: string]: ToolData;
}

/** Answers the call with a result. */
export type McpResponder = (result: McpResult) => void;
