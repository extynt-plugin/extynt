/** The sidecar's unresolved-native-call evidence, reduced to what the banner needs. Only the sidecar clears it. */
import { decode, literal, object } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";

export interface Quarantine { readonly kind: "mutation" | "read" | "unknown" }

const evidence = object({ accessKind: literal("mutation", "read") });

/**
 * `nativeAccessQuarantine` as the sidecar reports it: null (or absent) when clear, otherwise a quarantine whose kind
 * names the kind of call, "unknown" when the sidecar did not say which.
 */
export const quarantineDecoder: Decoder<Quarantine | null> = {
  run(input) {
    if (input === null || input === undefined) return null;
    const outcome = decode(evidence, input);
    return { kind: outcome.ok ? outcome.value.accessKind : "unknown" };
  },
};
