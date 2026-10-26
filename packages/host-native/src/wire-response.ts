// Classifies one line from the plugin as a response, an event or garbage, decoding it in a single pass.
import { decodeJson, literal, map, object, string, union } from "@extynt/decode";
import type { Decoder, Infer } from "@extynt/decode";
import { jsonValue } from "./json-value.js";
import { stringOrEmpty, wireError, wireTiming } from "./wire-common.js";
import { pluginEvent } from "./wire-watch.js";
import type { PluginEvent } from "./wire-watch.js";

const responseSuccess = object({ ok: literal(true), id: string(), op: stringOrEmpty, result: jsonValue, timing: wireTiming });
const responseFailure = object({ ok: literal(false), id: string(), op: stringOrEmpty, error: wireError });

export type ResponseSuccess = Infer<typeof responseSuccess>;
export type ResponseFailure = Infer<typeof responseFailure>;
export type ResponseEnvelope = ResponseSuccess | ResponseFailure;

/** One decoded line: a response, an event, or the reason the line is neither. */
export type ParsedLine =
  | { readonly kind: "response"; readonly value: ResponseEnvelope }
  | { readonly kind: "event"; readonly value: PluginEvent }
  | { readonly kind: "invalid"; readonly reason: string };

function invalid(reason: string): ParsedLine {
  return { kind: "invalid", reason };
}

const eventLine: Decoder<ParsedLine> = union(
  map(pluginEvent, (value): ParsedLine => ({ kind: "event", value })),
  map(object({ event: string() }), ({ event }) => invalid(`malformed or unknown event ${event}`)),
);

const wireLine: Decoder<ParsedLine> = union(
  eventLine,
  map(union(responseSuccess, responseFailure), (value): ParsedLine => ({ kind: "response", value })),
  map(object({}), () => invalid("neither a response nor an event")),
  map(jsonValue, () => invalid("not a JSON object")),
);

/** Classifies one line from the plugin: an event (has a string `event`), a response (has `id` and `ok`), or garbage with the reason it is garbage. */
export function parseResponseLine(line: string): ParsedLine {
  const decoded = decodeJson(line, wireLine);
  return decoded.ok ? decoded.value : invalid("not JSON");
}
