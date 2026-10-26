// What the sidecar remembers about plans it no longer holds. Plans live in memory, so a restart or a new After Effects session would
// otherwise answer a plan id with a bare "not found"; this small bounded file keeps why, and never anything about the plan's content.
import { join } from "node:path";
import { array, decode, literal, map, object, optional, string, type Decoder } from "@extynt/decode";
import type { LostPlanNote, LostPlans, StoredPlan } from "@extynt/mcp-server";
import { loadJsonFile, setAside, writeJsonAtomic } from "./ui-files.js";

const LEDGER_FILE = "plan-ledger.json";
const MAX_LEDGER_ENTRIES = 200;
const MAX_SUMMARY_CHARS = 200;

type PlanPhase = "waiting" | "queued" | "unsettled" | "settled";
type LostReason = "sidecar-restart" | "host-session";

interface LostMark {
  readonly reason: LostReason;
  readonly at: string;
}

interface LedgerEntry {
  readonly planId: string;
  readonly summary: string;
  readonly at: string;
  readonly phase: PlanPhase;
  readonly lost: LostMark | undefined;
}

const lostMark = object({ reason: literal("sidecar-restart", "host-session"), at: string() });

const lostMarkOrNothing: Decoder<LostMark | undefined> = {
  run: (input) => {
    const decoded = decode(lostMark, input);
    return decoded.ok ? decoded.value : undefined;
  },
};

const entryRow = map(
  object({ planId: string(), summary: string(), at: string(), phase: literal("waiting", "queued", "unsettled", "settled"), lost: optional(lostMarkOrNothing) }),
  (row): LedgerEntry => ({ planId: row.planId, summary: row.summary.slice(0, MAX_SUMMARY_CHARS), at: row.at, phase: row.phase, lost: row.lost }),
);

const storedEntry: Decoder<LedgerEntry | null> = {
  run: (input) => {
    const decoded = decode(entryRow, input);
    return decoded.ok ? decoded.value : null;
  },
};

const ledgerFile = object({ entries: array(storedEntry) });

const CAUSE_WHEN_NEVER_APPLIED: Readonly<Record<LostReason, string>> = {
  "sidecar-restart": "extynt's sidecar restarted",
  "host-session": "After Effects started a new session (it restarted, or the extynt panel reconnected)",
};

const CAUSE_WHEN_UNSETTLED: Readonly<Record<LostReason, string>> = {
  "sidecar-restart": "extynt's sidecar restarted",
  "host-session": "After Effects started a new session",
};

const PHASE_OF_STATUS: Readonly<Record<StoredPlan["status"], PlanPhase>> = {
  draft: "waiting",
  prepared: "waiting",
  presented: "waiting",
  approved: "queued",
  applying: "unsettled",
  undo_requested: "unsettled",
  applied: "settled",
  applied_unverified: "settled",
  verified: "settled",
  cancelled: "settled",
  failed: "settled",
  partially_undone: "settled",
  undone: "settled",
  undo_unverified: "settled",
};

function lostMessage(reason: LostReason, phase: PlanPhase): string {
  const why = CAUSE_WHEN_NEVER_APPLIED[reason];
  switch (phase) {
    case "waiting":
      return `This plan was cancelled because ${why} before it was approved; nothing was changed. Propose it again.`;
    case "queued":
      return `This plan was cancelled because ${why} before it was applied; nothing was changed, and a plan is never applied to a project opened afterwards. Propose it again.`;
    case "unsettled":
      return `${CAUSE_WHEN_UNSETTLED[reason]} while this plan was being applied, so whether it finished is not known. Read the project (ae_get_current_context) before proposing it again.`;
    case "settled":
      return `This plan had finished before ${why}, and extynt no longer holds its record. Its changes, if any, are still in the project; read it with ae_get_current_context.`;
  }
}

function noteOf(entry: LedgerEntry, lost: LostMark): LostPlanNote {
  return {
    planId: entry.planId,
    code: lost.reason === "sidecar-restart" ? "PLAN_EXPIRED_BY_RESTART" : "PLAN_DROPPED",
    message: lostMessage(lost.reason, entry.phase),
    summary: entry.summary,
    at: lost.at,
    cancelled: entry.phase === "waiting" || entry.phase === "queued",
  };
}

function newestFirst(a: LostPlanNote, b: LostPlanNote): number {
  if (a.at < b.at) return 1;
  return a.at > b.at ? -1 : 0;
}

function lostNotes(entries: Iterable<LedgerEntry>): LostPlanNote[] {
  const notes: LostPlanNote[] = [];
  for (const entry of entries) if (entry.lost) notes.push(noteOf(entry, entry.lost));
  return notes;
}

/**
 * Remembers why plans left the sidecar, in a bounded file beside the other sidecar state. A ledger that cannot be written
 * leaves a bare "not found" for the plan, never a failed plan; the failure is reported once per run of failures.
 * `startup` is called once with the plans this process holds: whatever the last process recorded as held and this one does not
 * is lost to the restart. `markLost` records a plan the sidecar is letting go of on purpose (the caller deletes it after) and
 * returns the note for the log. `sync` brings the ledger in step with the plans held now: new plans and changed phases are
 * recorded, and a plan that left the store without a reason (pruned) is forgotten.
 */
export class PlanLedger implements LostPlans {
  private readonly entries = new Map<string, LedgerEntry>();
  private dirty = false;
  private writeFailed = false;

  constructor(private readonly directory: string, private readonly now: () => Date) {
    const file = join(directory, LEDGER_FILE);
    const raw = loadJsonFile(file, now());
    const decoded = decode(ledgerFile, raw);
    if (!decoded.ok) {
      if (raw !== undefined) setAside(file, now());
      return;
    }
    for (const entry of decoded.value.entries) if (entry) this.entries.set(entry.planId, entry);
  }

  public startup(held: ReadonlySet<string>): void {
    const mark: LostMark = { reason: "sidecar-restart", at: this.now().toISOString() };
    for (const entry of [...this.entries.values()]) if (!entry.lost && !held.has(entry.planId)) this.replace({ ...entry, lost: mark });
    this.flush();
  }

  public markLost(record: StoredPlan, reason: LostReason): LostPlanNote {
    const mark: LostMark = { reason, at: this.now().toISOString() };
    const entry = { ...this.track(record), lost: mark };
    this.replace(entry);
    return noteOf(entry, mark);
  }

  public sync(plans: ReadonlyMap<string, StoredPlan>): void {
    for (const record of plans.values()) this.track(record);
    for (const entry of [...this.entries.values()]) {
      if (entry.lost || plans.has(entry.planId)) continue;
      this.entries.delete(entry.planId);
      this.dirty = true;
    }
    this.flush();
  }

  public find(planId: string): LostPlanNote | undefined {
    const entry = this.entries.get(planId);
    return entry?.lost ? noteOf(entry, entry.lost) : undefined;
  }

  public cancelled(limit: number): LostPlanNote[] {
    return lostNotes(this.entries.values()).filter((note) => note.cancelled).sort(newestFirst).slice(0, limit);
  }

  private replace(entry: LedgerEntry): void {
    this.entries.set(entry.planId, entry);
    this.dirty = true;
  }

  private track(record: StoredPlan): LedgerEntry {
    const planId = record.plan.planId;
    const phase = PHASE_OF_STATUS[record.status];
    const existing = this.entries.get(planId);
    if (existing && !existing.lost && existing.phase === phase) return existing;
    const entry: LedgerEntry = { planId, summary: existing?.summary ?? record.plan.summary.slice(0, MAX_SUMMARY_CHARS), at: existing?.at ?? record.createdAt, phase, lost: undefined };
    this.replace(entry);
    return entry;
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    for (const oldest of [...this.entries.keys()]) {
      if (this.entries.size <= MAX_LEDGER_ENTRIES) break;
      this.entries.delete(oldest);
    }
    try {
      writeJsonAtomic(this.directory, LEDGER_FILE, { version: 1, entries: [...this.entries.values()] });
      this.writeFailed = false;
    } catch (error) {
      if (!this.writeFailed) process.stderr.write(`[extynt] the plan ledger could not be written: ${error instanceof Error ? error.message : String(error)}\n`);
      this.writeFailed = true;
    }
  }
}
