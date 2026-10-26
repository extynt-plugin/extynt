/**
 * Which sections the sheet shows, as a pure function of the facts: a section appears only when it has something to say, so an
 * idle panel's sheet is nearly empty and a long job's sheet is full. No DOM here; the sheet draws what this decides.
 *
 * Order is the order on screen: Waiting for you, Now, Needs a look, Checklist, Changes, Connection, spend.
 */
import { needsLook, type ChangeRow } from "./panel-changes.js";
import type { WaitingItem } from "./panel-bar.js";
import type { HostStatus } from "./ui-contract.js";
import type { UiJob, UiMcpCall } from "./ui-jobs.js";

/** A part of the sheet. */
export type SheetSection = "waiting" | "now" | "look" | "checklist" | "changes" | "connection" | "spend";

/** An outside call is still worth a row for this long after it finished. */
export const RECENT_CALL_MS = 5 * 60 * 1000;
const MAX_CALL_ROWS = 5;

/** What the sheet decides from: the held plans, the job, outside calls, the changes and the state of each link. */
export interface SheetFacts {
  readonly waiting: ReadonlyArray<WaitingItem>;
  readonly job: UiJob | null;
  readonly jobRunning: boolean;
  readonly turnOpen: boolean;
  readonly calls: ReadonlyArray<UiMcpCall>;
  readonly nowMs: number;
  readonly rows: ReadonlyArray<ChangeRow>;
  readonly reachable: boolean;
  readonly host: HostStatus | null;
  readonly quarantined: boolean;
  readonly modelConfigured: boolean | null;
  readonly spend: boolean;
}

/** The outside calls the Now section lists: those running, then those finished in the last few minutes, newest first. */
export function nowCalls(calls: ReadonlyArray<UiMcpCall>, nowMs: number): UiMcpCall[] {
  const recent = calls.filter((call) => {
    if (call.state === "running") return true;
    const at = Date.parse(call.at);
    return isFinite(at) && nowMs - at <= RECENT_CALL_MS;
  });
  return recent.slice(-MAX_CALL_ROWS).reverse();
}

/** True when some link the panel depends on is not as it should be. */
export function connectionTroubled(facts: SheetFacts): boolean {
  if (!facts.reachable || facts.quarantined || facts.modelConfigured === false) return true;
  const host = facts.host;
  return host !== null && (host.state !== "online" || host.stall !== null);
}

function nowShown(facts: SheetFacts): boolean {
  return facts.jobRunning || facts.turnOpen || nowCalls(facts.calls, facts.nowMs).length > 0;
}

function hasChecklist(facts: SheetFacts): boolean {
  return Boolean(facts.job && facts.job.checklist && facts.job.checklist.items.length);
}

/** The sections to show, in screen order. */
export function visibleSections(facts: SheetFacts): SheetSection[] {
  const out: SheetSection[] = [];
  if (facts.waiting.length) out.push("waiting");
  if (nowShown(facts)) out.push("now");
  if (facts.rows.some(needsLook)) out.push("look");
  if (hasChecklist(facts)) out.push("checklist");
  if (facts.rows.length) out.push("changes");
  if (connectionTroubled(facts)) out.push("connection");
  if (facts.spend) out.push("spend");
  return out;
}

/** The filter chips appear only once an outside agent has made a call or a change. */
export function hasOutsideWork(calls: ReadonlyArray<UiMcpCall>, rows: ReadonlyArray<ChangeRow>): boolean {
  return calls.length > 0 || rows.some((row) => row.origin === "mcp");
}

/** Which origin the change list keeps. */
export type ChangeFilter = "all" | "agent" | "mcp";

/** What the filter keeps: "agent" is this panel's own chat and the designer, "mcp" is outside agents. A change with no known origin shows under All only. */
export function filterRows(rows: ReadonlyArray<ChangeRow>, filter: ChangeFilter): ReadonlyArray<ChangeRow> {
  if (filter === "all") return rows;
  if (filter === "mcp") return rows.filter((row) => row.origin === "mcp");
  return rows.filter((row) => row.origin === "chat" || row.origin === "designer");
}
