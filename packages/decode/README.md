# @extynt/decode

Small composable decoders that turn untrusted JSON-like input into exact TypeScript types. The static type is inferred
from the decoder, so the decoder is the single source of truth. This is the boundary mechanism for HTTP bodies, MCP
tool arguments, the native plugin protocol, ExtendScript results, model responses, environment variables and files.
Zero runtime dependencies.

```ts
import { array, brand, decode, decodeJson, literal, object, optional, string, taggedUnion, number } from "@extynt/decode";
import type { Infer } from "@extynt/decode";

const layerId = brand("LayerId", string({ nonEmpty: true }));
const shape = taggedUnion("kind", {
  circle: object({ kind: literal("circle"), radius: number({ min: 0 }) }),
  square: object({ kind: literal("square"), side: number({ min: 0 }) }),
});
const layer = object({ id: layerId, name: string({ maxLength: 80 }), note: optional(string()), shape });
type Layer = Infer<typeof layer>;

const result = decodeJson('{"id":"L1","name":"Title","shape":{"kind":"circle","radius":-1}}', layer);
// { ok: false, error: { path: "$.shape.radius", expected: "number of at least 0", found: "-1", ... } }
```

- Result: `decode(decoder, input)` returns `{ ok, value } | { ok, error }`; `decodeOrThrow` throws `DecodeFailure`;
  `decodeJson(text, decoder)` parses first and reports bad JSON as a `DecodeError` at `$`.
- Primitives: `string`, `number`, `boolean`, `literal`, `nullValue`.
- Combinators: `object` (ignores and drops extra keys), `strictObject` (rejects them), `optional`, `array`, `tuple`,
  `record`, `union`, `taggedUnion` (one lookup, no trial and error), `nullable`, `map`, `refine`, `lazy`, `brand`.
- `rawJson()` keeps a deliberately opaque payload as a branded JSON string.
- Failures carry a lazily rendered path (`$.layers[3].name`); a successful decode allocates only its output.

## Leniency, JSON and the helpers every boundary needs

Everything below is exported from the package root; nothing is specific to one area.

- **Never fail, keep going.** `fallback(inner, value)` yields the decoded value or `value` for input `inner` rejects
  (`fallback(d, undefined)` reads a bad field as not given, `fallback(d, null)` as absent). `absentAs(inner, value)`
  replaces only an absent (`undefined`) input and still rejects a present bad one; `absentAs(nullable(d), null)` is
  "absent or null reads as null". `skippingInvalid(item, readLimit?)` keeps the valid entries of an array and
  `skippingInvalidRecord(value)` the valid entries of an object. Wrap either in `fallback(..., [])` or `fallback(..., {})`
  when a non-container should read as empty. For an object field that may be missing or bad use
  `optional(fallback(d, undefined))`. None of them renders an error.
- **JSON.** `JsonValue`, `JsonArray` and `JsonObject` are the one JSON type (read-only, finite numbers). `jsonValue` and
  `jsonObject` accept them up to `JSON_NESTING_LIMIT` levels; `jsonValueWithin(levels)` sets another bound for hostile
  input. A `__proto__` key stays plain data. `isJsonObject` and `isJsonArray` narrow a `JsonValue`. `wireJson` turns any
  plain value into what it would be on the wire (`undefined` fields dropped, `NaN` as `null`, `toJSON` honoured) and
  rejects what JSON cannot carry. `rawJson()` is the opaque alternative.
- **Model output.** `decodeModelJson(text, decoder)` reads JSON a model wrote: the whole text, a fenced block, the span
  between the first and last `{` or `[`, and each without trailing commas. `stripCodeFence(text)` is the fence step alone.
- **Errors.** `decodeOrCode(decoder, input, code)` throws `Error(code)` when decoding fails. `isNotJson(error)` tells the
  `decodeJson` error for text that is not JSON from JSON of the wrong shape. `errorCauseCode` reads `error.cause.code`
  (Node's `ECONNRESET` and friends).
- **Small pieces.** `presentFields(fields)` copies an object without the keys that hold `undefined`, typed so those keys
  become optional (it is how to satisfy `exactOptionalPropertyTypes`). `isFiniteNumber(input)` narrows to a finite number.
  `Failure`, `fail` and `failShowing` let a hand-written decoder return a rejection that composes with the rest.
