/** A scoped read must not stand in for the whole project: only a whole read becomes the last snapshot. */
import type { SnapshotReply } from "./snapshot-reply.js";

/** True for a read of every composition; the host says otherwise only when it was asked to list some. */
export function wholeRead(snapshot: SnapshotReply): boolean {
  const scope = snapshot.result?.readScope;
  return !scope || scope.compositions === "all";
}
