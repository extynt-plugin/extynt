// The JSON value decoder for payloads the client carries without looking inside: checked once, never copied.
import { jsonValue as checkedJsonValue } from "@extynt/decode";
import type { Decoder, JsonValue } from "@extynt/decode";

/** Accepts any JSON value and returns it as it came, after one pass that checks every nested value. */
export const jsonValue: Decoder<JsonValue> = checkedJsonValue;
