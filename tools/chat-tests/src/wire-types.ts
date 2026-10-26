/**
 * The JSON-like value types the harness reads and writes.  Every chat-tests module imports them from here so that, when
 * `@extynt/decode` exports its `JsonValue`, the switch is this one file.  Until then they are the fake plugin's types.
 */
export type { WireObject, WireValue } from "@extynt/fake-plugin";
