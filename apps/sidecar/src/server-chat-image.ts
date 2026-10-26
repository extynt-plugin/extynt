// The one screenshot a chat message may carry, checked to be what this panel's capture could have produced.
import { decode, type JsonValue, literal, object, string } from "@extynt/decode";


const chatImage = object({ mediaType: literal("image/png", "image/jpeg"), base64: string({ minLength: 16, maxLength: 1_400_000, pattern: /^[A-Za-z0-9+/]+={0,2}$/ }) });

/** The screenshot one chat message may carry, or null when it is not one this panel could have produced. */
export function normalizeChatImage(value: JsonValue | undefined): { mediaType: string; base64: string } | null {
  const read = decode(chatImage, value);
  return read.ok ? read.value : null;
}
