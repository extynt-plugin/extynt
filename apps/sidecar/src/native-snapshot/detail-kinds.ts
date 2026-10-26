/** The detail kinds the jsx details call can supply, in the order a request lists them. */
import type { DetailKind } from "./types.js";

/** The tag the host puts at the start of every keyframe digest (`AE_KEY_DIGEST_VERSION` in host-shared.jsx; a test holds the two equal): details stored under another tag are never reused. */
export const KEY_DIGEST_FORMAT = "kd2";

/** Every kind, in the order a request lists them. */
export const DETAIL_KINDS: readonly DetailKind[] = ["textDocument", "keyDigest", "marker", "maskPath", "shapePath", "layerRef"];

/** The kinds in request order, without duplicates. */
export function orderedKinds(kinds: Iterable<DetailKind>): DetailKind[] {
  const wanted = new Set(kinds);
  return DETAIL_KINDS.filter((kind) => wanted.has(kind));
}
