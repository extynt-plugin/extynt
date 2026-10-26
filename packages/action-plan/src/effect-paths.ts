// Effect path spelling: an effect path is built from the effect's matchName by escaping "%", "/" and "#" and appending a canonical "#N" ordinal (2..128).
// A path only names its effect when its segment decodes to that matchName, so a mismatch cannot point the host at another effect.
import type { JsonValue } from "@extynt/decode";

/** The group every effect path starts with. */
export const EFFECT_PARADE_PREFIX = "ADBE Effect Parade/";

const MIN_ORDINAL = 2;
const MAX_ORDINAL = 128;

function decodeEffectSegment(segment: string): string { return segment.replace(/%2F/g, "/").replace(/%23/g, "#").replace(/%25/g, "%"); }

function effectOrdinalBase(segment: string): string | undefined {
  const digits = /#([0-9]{1,4})$/.exec(segment)?.[1];
  if (!digits) return segment;
  if (!/^[1-9][0-9]{0,3}$/.test(digits) || Number(digits) < MIN_ORDINAL || Number(digits) > MAX_ORDINAL) return undefined;
  return segment.slice(0, segment.length - digits.length - 1);
}

/** Whether a matchName ending in a raw "#N" sits unescaped in the path, which the host reads as the bare effect's Nth instance and resolves to nothing. */
export function ordinalInMatchName(effectPath: JsonValue | undefined, matchName: JsonValue | undefined): boolean {
  return typeof matchName === "string" && /#[0-9]{1,4}$/.test(matchName) && effectPath === `${EFFECT_PARADE_PREFIX}${matchName}`;
}

/** Whether the path's segment, with or without its canonical ordinal, decodes to the matchName. */
export function effectPathNamesMatchName(effectPath: string, matchName: string): boolean {
  if (!effectPath.startsWith(EFFECT_PARADE_PREFIX)) return false;
  const segment = effectPath.slice(EFFECT_PARADE_PREFIX.length);
  if (segment === matchName || decodeEffectSegment(segment) === matchName) return true;
  const base = effectOrdinalBase(segment);
  return base !== undefined && (base === matchName || decodeEffectSegment(base) === matchName);
}
