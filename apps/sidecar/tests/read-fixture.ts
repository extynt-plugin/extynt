/** The fixtures the read-scheduling suites share: a sidecar on an injectable clock, the project as the host answers a (scoped) read of it, and the panel's focus report. */
import { textOf } from "./http-json.js";
import { EVENT_STAMP_TTL_MS } from "../src/host/events.js";
import { tickReadScheduler } from "../src/read-scheduler.js";
import { authorization, claimOver, mutableSnapshot, receiptResponse, sidecarFor, token } from "./sidecar-fixture.js";
import type { Opaque } from "../src/snapshot-view.js";
import assert from "node:assert/strict";

export const PANEL = { "X-AE-Panel-Instance": "panel-reads" };
export const focusBody = (over: Record<string, Opaque> = {}): Record<string, Opaque> => ({ schemaVersion: "0.1", projectPath: null, projectName: "Fixture", epoch: 3, revision: 10, activeCompositionId: "comp-1", activeCompositionName: "Main", selected: ["layer-1"], selectedLayers: [{ id: "layer-1", index: 1, name: "Original" }], ...over });

type Mutable = ReturnType<typeof mutableSnapshot>;
type ReadOptions = { name?: string; scoped?: { items: "read" | "skipped" }; compositions?: string[]; epoch?: number; stamp?: boolean; selected?: string[] };
type ReadFixture = Omit<Mutable, "result"> & { result: Omit<Mutable["result"], "hostStamp"> & { itemCount: number; readScope: { compositions: string; items: string }; items: Array<Record<string, Opaque>>; sources: never[]; compositionPages: { unread: string[]; oversized: string[]; capped: boolean }; hostStamp?: { epoch: number; revision: number } } };

function hostStampOf(over: ReadOptions, revision: number): { hostStamp?: { epoch: number; revision: number } } {
  return over.stamp === false ? {} : { hostStamp: { epoch: over.epoch ?? 3, revision } };
}

/** A read of the fixture project (two compositions) as the host answers it: `scoped` marks a read of listed compositions. */
export function read(requestId: string, revision: number, over: ReadOptions = {}): ReadFixture {
  const base = mutableSnapshot(requestId, over.selected ?? ["layer-1"], over.name ?? "Original"), main = base.result.compositions[0];
  assert.ok(main);
  const all = [main, { ...main, id: "comp-2", name: "Other", layers: [] }], wanted = over.compositions;
  const compositions = wanted ? all.filter((composition) => wanted.includes(composition.id)) : all, stamped = hostStampOf(over, revision);
  const items = [{ id: "comp-1", name: "Main", type: "composition", parentFolderId: null, compositionId: "comp-1", sourceId: null }, { id: "comp-2", name: "Other", type: "composition", parentFolderId: null, compositionId: "comp-2", sourceId: null }];
  const scope = over.scoped ? { compositions: "listed", items: over.scoped.items } : { compositions: "all", items: "read" };
  return { ...base, result: { ...base.result, compositions, itemCount: 2, readScope: scope, items: over.scoped?.items === "skipped" ? [] : items, sources: [], compositionPages: { unread: [], oversized: [], capped: false }, ...stamped } };
}

type Cleanup = { after: (fn: () => void | Promise<void>) => void };
type Sidecar = ReturnType<typeof sidecarFor>;
type StampOverride = { revision: number; items?: number; epoch?: number };
export interface Harness {
  sidecar: Sidecar;
  base: string;
  clock: { ms: number };
  post: <T>(path: string, value: T) => Promise<Response>;
  claim: (stamp?: StampOverride) => Promise<ReturnType<typeof claimOver>>;
  refreshes: () => Array<Sidecar["agentMailbox"][number]["approvedData"]>;
  stamp: (revision: number, items?: number) => void;
  focus: (over?: Record<string, Opaque>) => Promise<Response>;
}

export async function start(t: Cleanup): Promise<Harness> {
  const clock = { ms: Date.parse("2026-10-03T12:00:00.000Z") };
  const sidecar = sidecarFor({ port: 0, token, panelSessionId: "panel-reads", quietAgentLog: true, panelSnapshotWaitMs: 150, now: () => new Date(clock.ms) });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`, json = { ...authorization, "content-type": "application/json", ...PANEL };
  const post = <T>(path: string, value: T) => path === "/v1/receipts" ? receiptResponse(sidecar, value) : fetch(`${base}${path}`, { method: "POST", headers: json, body: JSON.stringify(value) });
  const claim = async (stamp?: StampOverride) => {
    if (stamp) sidecar.liveStamp = { epoch: stamp.epoch ?? 3, revision: stamp.revision, items: stamp.items ?? null, at: clock.ms, ttlMs: EVENT_STAMP_TTL_MS };
    tickReadScheduler(sidecar, "event");
    return claimOver(sidecar);
  };
  const refreshes = () => sidecar.agentMailbox.filter((item) => item.approvedData.kind === "refresh_snapshot").map((item) => item.approvedData);
  await fetch(`${base}/v1/pair`, { headers: json });
  const stamp = (revision: number, items = 2) => { sidecar.liveStamp = { epoch: 3, revision, items, at: clock.ms }; };
  return { sidecar, base, clock, post, claim, refreshes, stamp, focus: (over: Record<string, Opaque> = {}) => post("/v1/panel/focus", focusBody(over)) };
}

/** Pair, take the post-pair read, answer it, and report AE's view: the state every later case starts from. */
export async function landed(t: Cleanup): Promise<Harness & { firstReadId: string }> {
  const h = await start(t);
  const first = await h.claim();
  assert.equal((await h.post("/v1/snapshots", read(textOf(first.body, "item.readId"), 10))).status, 201);
  await h.focus();
  return { ...h, firstReadId: textOf(first.body, "item.readId") };
}

