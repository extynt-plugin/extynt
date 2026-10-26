/**
 * The records of the native bridge lease and how they are read back: the journal file holds at most one active lease and
 * the tombstone of the last settled one, and every field of it is bounded text. The lease and its file storage share these shapes.
 */
import { randomUUID } from "node:crypto";
import { literal, nullable, object, optional, refine, strictObject, string, type Infer } from "@extynt/decode";

export const boundedText = string({ minLength: 1, maxLength: 128 });
const logicalOwnerShape = object({ kind: boundedText, id: boundedText });
const identityShape = strictObject({ leaseId: boundedText, settlementToken: boundedText, epoch: boundedText, owner: boundedText, requestId: boundedText, kind: literal("read", "mutation") });
const activeShape = object({ identity: identityShape, logicalOwner: optional(logicalOwnerShape) });
const tombstoneShape = object({ identity: identityShape, outcome: literal("callback-received", "native-not-started", "owner-replaced"), logicalOwner: optional(logicalOwnerShape) });
const journalBase = object({ schemaVersion: literal("native-bridge-lease/1"), epoch: boundedText, active: nullable(activeShape), settled: nullable(tombstoneShape) });

export type LogicalOwner = Infer<typeof logicalOwnerShape>;
export type NativeBridgeIdentity = Infer<typeof identityShape>;
export type ActiveLease = Infer<typeof activeShape>;
export type Tombstone = Infer<typeof tombstoneShape>;
export type Journal = Infer<typeof journalBase>;
export type Durability = "full" | "none";

const epochsAgree = (journal: Journal): journal is Journal => [journal.active?.identity, journal.settled?.identity].every((identity) => identity === undefined || identity.epoch === journal.epoch);

export const journalShape = refine(journalBase, epochsAgree, "entries from the journal's own epoch");
export const reserveShape = strictObject({ requestId: boundedText, kind: literal("read", "mutation") });
export const settleShape = strictObject({ lease: identityShape, outcome: literal("callback-received", "native-not-started") });

export function freshJournal(): Journal {
  return { schemaVersion: "native-bridge-lease/1", epoch: randomUUID(), active: null, settled: null };
}

export function durabilityOf(kind: NativeBridgeIdentity["kind"]): Durability {
  return kind === "mutation" ? "full" : "none";
}

export function ownerField(logicalOwner: LogicalOwner | undefined): { logicalOwner?: LogicalOwner } {
  return logicalOwner ? { logicalOwner: { ...logicalOwner } } : {};
}

export function sameRequest(identity: NativeBridgeIdentity, request: Pick<NativeBridgeIdentity, "owner" | "requestId" | "kind">): boolean {
  return identity.owner === request.owner && identity.requestId === request.requestId && identity.kind === request.kind;
}

export function equalIdentity(left: NativeBridgeIdentity, right: NativeBridgeIdentity): boolean {
  return left.leaseId === right.leaseId && left.settlementToken === right.settlementToken && left.epoch === right.epoch && sameRequest(left, right);
}
