/**
 * The lease on the native bridge, separate from logical apply and collection ownership. Reservation is the durable intent
 * to dispatch. Only a mutation lease blocks native access: a read cannot change the project, and After Effects runs
 * ExtendScript calls one at a time, so an orphaned read lease is replaced by the next reservation and a pending mutation
 * is never overtaken. A mutation lease is released only by its callback or by a newly paired panel instance, whose reload
 * proves the old caller can no longer settle it. After a crash nothing recovers a read lease: a missing one and a
 * replaced one look the same to every caller. The journal file is the storage module's.
 */
import { randomUUID } from "node:crypto";
import { decode } from "@extynt/decode";
import {
  boundedText, durabilityOf, equalIdentity, ownerField, reserveShape, sameRequest, settleShape,
  type ActiveLease, type LogicalOwner, type NativeBridgeIdentity, type Tombstone,
} from "./native-bridge-journal.js";
import { NativeBridgeStorage } from "./native-bridge-storage.js";
import type { Opaque } from "./snapshot-view.js";

type Reservation = Pick<NativeBridgeIdentity, "owner" | "requestId" | "kind">;
type Outcome = "callback-received" | "native-not-started";
interface Settlement { ok: true; settled: true; idempotent: boolean; logicalOwner?: LogicalOwner }
interface Release { released: boolean; kind?: NativeBridgeIdentity["kind"]; logicalOwner?: LogicalOwner }

function callbackFrom(settled: Tombstone | null, owner: string, requestId: string): boolean {
  return settled?.outcome === "callback-received" && settled.identity.kind === "mutation" && settled.identity.owner === owner && settled.identity.requestId === requestId;
}

function applyOwned(settled: Tombstone | null, planId: string): boolean {
  return settled?.logicalOwner?.kind === "apply_plan" && settled.logicalOwner.id === planId;
}

/** The durable lease on the native bridge: who holds it, for what, and the tombstone of the last one settled. */
export class NativeBridgeLease {
  private readonly store: NativeBridgeStorage;

  constructor(directory: string) {
    this.store = new NativeBridgeStorage(directory);
  }

  reserve(owner: string, input: Opaque, logicalOwner?: LogicalOwner): { ok: true; lease: NativeBridgeIdentity } {
    const request = decode(reserveShape, input);
    if (!decode(boundedText, owner).ok || !request.ok) throw Error("NATIVE_BRIDGE_INVALID_REQUEST");
    return this.store.mutate(() => this.reserveWithin({ owner, ...request.value }, logicalOwner));
  }

  settle(owner: string, input: Opaque): Settlement {
    const request = decode(settleShape, input);
    if (!request.ok || owner !== request.value.lease.owner) throw Error("NATIVE_BRIDGE_INVALID_REQUEST");
    const { lease, outcome } = request.value;
    return this.store.mutate(() => this.settleWithin(lease, outcome));
  }

  releaseForNewOwner(owner: string): Release {
    if (this.store.failure) return { released: false };
    try { this.store.refresh(); } catch { return { released: false }; }
    const current = this.store.journal.active;
    if (!current || current.identity.owner === owner) return { released: false };
    return this.store.mutate(() => this.releaseWithin(owner));
  }

  activeRequestMatches(requestId: Opaque): boolean {
    this.accessQuarantine();
    return typeof requestId === "string" && this.store.journal.active?.identity.requestId === requestId;
  }

  activeLogicalMatches(kind: string, id: string): boolean {
    this.accessQuarantine();
    const owner = this.store.journal.active?.logicalOwner;
    return owner?.kind === kind && owner.id === id;
  }

  settledRequestMatches(owner: string, requestId: string): boolean {
    this.accessQuarantine();
    const settled = this.store.journal.settled;
    return !this.store.failure && settled?.identity.owner === owner && settled.identity.requestId === requestId;
  }

  mutationCallbackMatches(owner: string, requestId: string, planId: string): boolean {
    this.accessQuarantine();
    if (this.store.failure) return false;
    const settled = this.store.journal.settled;
    return callbackFrom(settled, owner, requestId) && applyOwned(settled, planId);
  }

  accessQuarantine(): Record<string, Opaque> | null {
    this.store.check();
    const active = this.store.journal.active;
    if (!this.store.failure && (!active || active.identity.kind === "read")) return null;
    return this.unresolved(active);
  }

  private reserveWithin(request: Reservation, logicalOwner: LogicalOwner | undefined): { ok: true; lease: NativeBridgeIdentity } {
    const journal = this.store.journal, current = journal.active;
    if (current && sameRequest(current.identity, request)) return { ok: true, lease: { ...current.identity } };
    this.refuseReservation(request);
    const lease: NativeBridgeIdentity = { leaseId: randomUUID(), settlementToken: randomUUID(), epoch: journal.epoch, ...request };
    this.store.persist({ ...journal, active: { identity: lease, ...ownerField(logicalOwner) } }, durabilityOf(request.kind));
    return { ok: true, lease: { ...lease } };
  }

  private refuseReservation(request: Reservation): void {
    const { active, settled } = this.store.journal;
    if (active?.identity.kind === "mutation") throw Error("NATIVE_BRIDGE_BUSY");
    if (settled?.identity.owner === request.owner && settled.identity.requestId === request.requestId) throw Error("NATIVE_BRIDGE_ALREADY_SETTLED");
  }

  private settleWithin(lease: NativeBridgeIdentity, outcome: Outcome): Settlement {
    const journal = this.store.journal, current = journal.active;
    if (!current || !equalIdentity(current.identity, lease)) return this.settledAgain(lease, outcome);
    this.store.persist({ ...journal, active: null, settled: { identity: lease, outcome, ...ownerField(current.logicalOwner) } }, durabilityOf(lease.kind));
    return { ok: true, settled: true, idempotent: false, ...ownerField(current.logicalOwner) };
  }

  private settledAgain(lease: NativeBridgeIdentity, outcome: Outcome): Settlement {
    const prior = this.store.journal.settled;
    if (prior && equalIdentity(prior.identity, lease) && prior.outcome === outcome) return { ok: true, settled: true, idempotent: true };
    throw Error("NATIVE_BRIDGE_IDENTITY_MISMATCH");
  }

  private releaseWithin(owner: string): Release {
    const journal = this.store.journal, active = journal.active;
    if (!active || active.identity.owner === owner) return { released: false };
    this.store.persist({ ...journal, active: null, settled: { identity: active.identity, outcome: "owner-replaced", ...ownerField(active.logicalOwner) } }, durabilityOf(active.identity.kind));
    return { released: true, kind: active.identity.kind, ...ownerField(active.logicalOwner) };
  }

  private unresolved(active: ActiveLease | null): Record<string, Opaque> {
    return {
      state: "unresolved", accessKind: active?.identity.kind ?? "unknown", operation: "native_bridge", code: this.store.failure ?? "NATIVE_BRIDGE_RESERVED", requestId: active?.identity.requestId ?? null,
      message: "A durable native bridge lease remains unresolved. Do not retry or issue native calls. Wait for the exact callback settlement; if it cannot arrive, quit After Effects and obtain explicit local journal recovery. Sidecar restart and panel reconnect do not clear this lease.",
      recovery: "exact-callback-or-explicit-local-journal-recovery",
    };
  }
}
