// What an MCP tool call carries and how it is decoded once: the request body, the open map of the tool's arguments and the few argument fields the sidecar itself reads.
import { decodeOrThrow, fallback, jsonValueWithin, literal, map, nullable, number, object, optional, record, string, type Decoder, type Infer, type JsonObject, type ObjectOf, type Shape } from "@extynt/decode";

const MAX_ARGUMENT_NESTING = 32;

type ToolArguments = JsonObject;

function trueFlag(): Decoder<boolean> {
  return fallback(literal(true), false);
}

function textOrEmpty(): Decoder<string> {
  return fallback(string(), "");
}

/** An object whose every field is tolerant; an input that is not an object reads as an object with every field absent, so decoding never fails. */
export function lenientObject<Fields extends Shape>(fields: Fields): Decoder<ObjectOf<Fields>> {
  const inner = object(fields);
  const blank = decodeOrThrow(inner, {});
  return fallback(inner, blank);
}

const callControls = object({
  waitSeconds: fallback(number(), undefined),
  planId: textOrEmpty(),
  captureId: textOrEmpty(),
  request: fallback(string(), undefined),
  compositionId: fallback(string(), undefined),
  apply: trueFlag(),
  acknowledgeUnverified: trueFlag(),
});

type CallControls = Infer<typeof callControls>;

/** One tool call: the tool, its arguments as sent and the fields of them the sidecar reads. */
export interface McpInput {
  readonly name: string;
  readonly arguments: ToolArguments;
  readonly controls: CallControls;
}

/** A tool call for the given tool and arguments. */
export function mcpInputOf(name: string, given: ToolArguments): McpInput {
  return { name, arguments: given, controls: decodeOrThrow(callControls, given) };
}

const toolArguments: Decoder<ToolArguments> = record(string(), jsonValueWithin(MAX_ARGUMENT_NESTING));

/** The body of a tool call: a tool name and, optionally, an object of arguments. */
export const mcpInput: Decoder<McpInput> = map(
  object({ name: string(), arguments: optional(nullable(toolArguments)) }),
  (body) => mcpInputOf(body.name, body.arguments ?? {}),
);
