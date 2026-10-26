// What a caught workflow failure says: its coded name and its message, read from whatever was thrown.
import { fallback, map, object, string, type Decoder } from "@extynt/decode";

/** The `code` a thrown value carries, or undefined when it has none. */
export const thrownCode: Decoder<string | undefined> = fallback(map(object({ code: string() }), (coded) => coded.code), undefined);

/** The message of a thrown error, or the thrown value as text. */
export const thrownMessage: Decoder<string> = { run: (error) => (error instanceof Error ? error.message : String(error)) };
