// The body of a chat request as the sidecar decodes it once at the door, so the chat route works with exact types from there on.
import { boolean, type Infer, isJsonObject, type JsonValue, jsonValueWithin, map, object, optional, refine, string } from "@extynt/decode";
import type { ChatMessage, ContextSection, ContextSelectionOptions } from "@extynt/llm";
import { isWorkflowId } from "@extynt/workflow";


const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const JSON_NESTING_LIMIT = 32;
const CONTEXT_SECTIONS: ReadonlySet<string> = new Set(["host", "project", "activeComposition", "selectedLayers", "selectionAncestors", "sources", "items"]);

function isJsonList(entry: JsonValue): entry is readonly JsonValue[] {
  return Array.isArray(entry);
}

function isContextSection(entry: JsonValue): entry is ContextSection {
  return typeof entry === "string" && CONTEXT_SECTIONS.has(entry);
}

function chatMessageOf(entry: JsonValue): ChatMessage | undefined {
  if (!isJsonObject(entry)) return undefined;
  const { role, content } = entry;
  return (role === "user" || role === "assistant") && typeof content === "string" ? { role, content } : undefined;
}

function chatHistoryOf(entry: JsonValue): ChatMessage[] | undefined {
  if (!isJsonList(entry)) return undefined;
  return entry.flatMap((turn) => chatMessageOf(turn) ?? []);
}

function numberOptionsOf(entry: { readonly [key: string]: JsonValue }): ContextSelectionOptions {
  const { maxHistoryMessages, maxPropertiesPerLayer, maxPropertyDepth, maxStringLength } = entry;
  return {
    ...(typeof maxHistoryMessages === "number" ? { maxHistoryMessages } : {}),
    ...(typeof maxPropertiesPerLayer === "number" ? { maxPropertiesPerLayer } : {}),
    ...(typeof maxPropertyDepth === "number" ? { maxPropertyDepth } : {}),
    ...(typeof maxStringLength === "number" ? { maxStringLength } : {}),
  };
}

function flagOptionsOf(entry: { readonly [key: string]: JsonValue }): ContextSelectionOptions {
  const { includeExpressions, includeFilePaths } = entry;
  return {
    ...(typeof includeExpressions === "boolean" ? { includeExpressions } : {}),
    ...(typeof includeFilePaths === "boolean" ? { includeFilePaths } : {}),
  };
}

function contextSelectionOf(entry: JsonValue): ContextSelectionOptions | undefined {
  if (!isJsonObject(entry)) return undefined;
  const { include } = entry;
  return { ...(include !== undefined && isJsonList(include) ? { include: include.filter(isContextSection) } : {}), ...numberOptionsOf(entry), ...flagOptionsOf(entry) };
}

const workflowJobId = refine(string(), isWorkflowId, "workflow job id");
const lenientJson = jsonValueWithin(JSON_NESTING_LIMIT);

/**
 * The chat request: `requestId` and `message` are required, `sessionId` and `continueJobId` must be well-formed when
 * present, and `allowLongPrompt` is the user's Send anyway for a prompt over the workflow goal limit. `history` and
 * `context` are deliberately lenient: turns and options of the wrong type are dropped instead of refusing the request,
 * leaving the provider's defaults in charge. `image` and `images` stay JSON for the attachment checks that follow.
 */
export const chatRequest = object({
  requestId: string(),
  message: string(),
  sessionId: optional(string({ pattern: SESSION_ID_PATTERN })),
  continueJobId: optional(workflowJobId),
  allowLongPrompt: optional(boolean()),
  history: optional(map(lenientJson, chatHistoryOf)),
  context: optional(map(lenientJson, contextSelectionOf)),
  image: optional(lenientJson),
  images: optional(lenientJson),
});

/** A decoded chat request. */
export type ChatInput = Infer<typeof chatRequest>;
