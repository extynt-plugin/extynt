// Decoders for the bounded, untrusted page the host returns for one catalogue probe or project-instance read; nothing from a page is stored before it passes here.
import { absentAs, array, boolean, decode, fallback, lazy, literal, map, nullable, number, object, optional, refine, string, union, type JsonValue } from "@extynt/decode";
import type { Decoder, ObjectOf } from "@extynt/decode";
import { integerFrom, ordinal } from "./native-field-decoders.js";

/** One control of a probed effect: a group with its children or a property with its value facts; `units` is AE's Property.unitsText as reported, or null when AE reports none. */
export interface CatalogueControlRow {
  matchName: string; name: string; index: number; kind: "group" | "property";
  childCount: number; children: CatalogueControlRow[];
  valueType: string | null; defaultValue: number | number[] | null;
  min: number | null; max: number | null; units: string | null; items: string[] | null; isDropdown: boolean;
  canVary: boolean | null; canSetExpression: boolean | null; hidden: boolean | null;
}

/** How long adding the effect held AE (a plugin window waits on the user) and how many project items it left behind. */
export interface CatalogueApplyCost { applyMs: number | null; createdItems: number }

/** One probed effect's control tree and what adding it cost. */
export interface CatalogueEffectResult extends CatalogueApplyCost { matchName: string; displayName: string; controls: CatalogueControlRow[]; truncated: boolean }

interface CatalogueFailure extends CatalogueApplyCost { matchName: string; code: string; detail: string | null }

/** A whole probe page: the host that answered, what it probed and refused, what it left unasked, and whether it cleaned up. */
export interface CataloguePage {
  requestId: string; host: { version: string; build: string | null };
  results: CatalogueEffectResult[]; failures: CatalogueFailure[]; remaining: string[]; elapsedMs: number; cleanedUp: boolean;
}

/** What a read of one real effect in the user's project returned: its control tree, with no apply cost because nothing was applied. */
export interface CatalogueInstanceRead { matchName: string; displayName: string; controls: CatalogueControlRow[]; truncated: boolean; host: { version: string; build: string | null } }

/** How a probe page answered its ticket: a whole page, a host refusal, or a page that cannot be trusted. */
export type CataloguePageOutcome =
  | { kind: "page"; page: CataloguePage }
  | { kind: "refused"; code: string; reason: string | null }
  | { kind: "invalid"; code: "CATALOGUE_PAGE_INVALID" | "CATALOGUE_TICKET_MISMATCH" };

type CatalogueInstanceOutcome =
  | { kind: "instance"; read: CatalogueInstanceRead }
  | { kind: "refused"; code: string; reason: string | null }
  | { kind: "invalid"; code: "CATALOGUE_PAGE_INVALID" | "CATALOGUE_TICKET_MISMATCH" };

/** The most effects one probe page may name. */
export const CATALOGUE_MAX_EFFECTS = 16;

const MAX_ROWS = 4096;
const MAX_DEPTH = 16;
const MAX_MENU_ITEMS = 512;
const MAX_TEXT = 512;
const MAX_DETAIL = 300;
const MAX_MS = 3_600_000;
const MAX_CREATED_ITEMS = 10_000;
const MAX_DEFAULT_COMPONENTS = 16;
const REFUSAL_CODE = /^[A-Z_]{1,64}$/;

const text = string({ maxLength: MAX_TEXT });
const flag = fallback(boolean(), null);
const finiteOrNull = fallback(number(), null);

const defaultValue: Decoder<number | number[] | null> = fallback(union(number(), map(array(number(), { minLength: 1, maxLength: MAX_DEFAULT_COMPONENTS }), (components) => [...components])), null);
const menuItems: Decoder<string[] | null> = fallback(map(array(text, { maxLength: MAX_MENU_ITEMS }), (items) => [...items]), null);

const rowFields = {
  matchName: text, name: text, index: ordinal, childCount: fallback(integerFrom(Number.MIN_SAFE_INTEGER), null),
  valueType: fallback(string({ maxLength: 64 }), null), defaultValue,
  hasMin: fallback(literal(true), false), min: finiteOrNull, hasMax: fallback(literal(true), false), max: finiteOrNull,
  unitsText: fallback(string({ nonEmpty: true, maxLength: 80 }), null), items: menuItems, isDropdown: fallback(literal(true), false),
  canVary: flag, canSetExpression: flag, hidden: flag,
};

function controlRow(kind: CatalogueControlRow["kind"], fields: ObjectOf<typeof rowFields>, children: CatalogueControlRow[]): CatalogueControlRow {
  const { hasMin, hasMax, childCount, min, max, unitsText, ...rest } = fields;
  return { ...rest, kind, children, childCount: childCount ?? children.length, min: hasMin ? min : null, max: hasMax ? max : null, units: unitsText };
}

function rowAt(depth: number): Decoder<CatalogueControlRow> {
  const nested = array(lazy(() => rowAt(depth + 1)), depth >= MAX_DEPTH ? { maxLength: 0 } : {});
  const group = map(object({ kind: literal("group"), ...rowFields, children: optional(nested) }), (row) => controlRow("group", row, [...(row.children ?? [])]));
  const property = map(object({ kind: literal("property"), ...rowFields }), (row) => controlRow("property", row, []));
  return union(group, property);
}

function rowCount(rows: ReadonlyArray<CatalogueControlRow>): number {
  return rows.reduce((total, row) => total + 1 + rowCount(row.children), 0);
}

const boundedControls: Decoder<CatalogueControlRow[]> = map(
  refine(array(rowAt(1)), (rows): rows is ReadonlyArray<CatalogueControlRow> => rowCount(rows) <= MAX_ROWS, `at most ${MAX_ROWS} control rows`),
  (rows) => [...rows],
);

const applyCost = {
  applyMs: fallback(map(number(), (milliseconds) => Math.max(0, Math.min(MAX_MS, milliseconds))), null),
  createdItems: fallback(map(integerFrom(1), (items) => Math.min(items, MAX_CREATED_ITEMS)), 0),
};

const effectResult = object({ matchName: text, displayName: text, controls: boundedControls, truncated: fallback(literal(true), false), ...applyCost });

const detail: Decoder<string | null> = fallback(map(string(), (words) => words.replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL) || null), null);
const refusalCode = string({ maxLength: 64, pattern: REFUSAL_CODE });
const failure = object({ matchName: text, code: refusalCode, detail, ...applyCost });

const hostIdentity = object({ version: string({ maxLength: 256 }), build: absentAs(nullable(string({ maxLength: 256 })), null) });
const names = map(array(text, { maxLength: CATALOGUE_MAX_EFFECTS }), (listed) => [...listed]);

const pageBody = object({
  host: hostIdentity,
  failures: map(array(failure, { maxLength: CATALOGUE_MAX_EFFECTS * 2 }), (entries) => [...entries]),
  remaining: names,
  results: map(array(effectResult, { maxLength: CATALOGUE_MAX_EFFECTS }), (entries) => [...entries]),
  elapsedMs: fallback(map(number(), (milliseconds) => Math.max(0, Math.min(MAX_MS, milliseconds))), 0),
  cleanedUp: fallback(literal(true), false),
});

const instanceBody = object({ host: hostIdentity, instance: effectResult });

const envelope = object({ requestId: optional(fallback(string(), null)), ok: fallback(boolean(), null) });
const startedNothing = object({ ok: literal(false), mayHaveMutated: literal(false) });
const refusalBody = object({ error: fallback(object({ code: fallback(refusalCode, null), reason: fallback(string({ maxLength: 64 }), null) }), { code: null, reason: null }) });

function mentionsOnly(requested: readonly string[], ...lists: ReadonlyArray<readonly string[]>): boolean {
  const asked = new Set(requested);
  return lists.every((listed) => listed.every((name) => asked.has(name)));
}

type Unanswered = Exclude<CataloguePageOutcome, { kind: "page" }>;

const INVALID: Unanswered = { kind: "invalid", code: "CATALOGUE_PAGE_INVALID" };
const MISMATCH: Unanswered = { kind: "invalid", code: "CATALOGUE_TICKET_MISMATCH" };

function refusal(input: JsonValue): Unanswered {
  const decoded = decode(refusalBody, input);
  const error = decoded.ok ? decoded.value.error : undefined;
  return error?.code ? { kind: "refused", code: error.code, reason: error.reason } : INVALID;
}

function unanswered(input: JsonValue, ticket: string): Unanswered | "answered" {
  const head = decode(envelope, input);
  if (!head.ok) return INVALID;
  const schedulerRefusal = head.value.requestId === undefined && head.value.ok === false;
  if (head.value.requestId !== ticket && !schedulerRefusal) return MISMATCH;
  if (head.value.ok === false) return refusal(input);
  return head.value.ok === true ? "answered" : INVALID;
}

/** The page must answer exactly the ticket it was issued for and may only mention effects that ticket asked about. */
export function parseCataloguePage(value: JsonValue, ticket: string, requested: readonly string[]): CataloguePageOutcome {
  const early = unanswered(value, ticket);
  if (early !== "answered") return early;
  const body = decode(pageBody, value);
  if (!body.ok) return INVALID;
  const { host, failures, remaining, results, elapsedMs, cleanedUp } = body.value;
  if (!mentionsOnly(requested, results.map((result) => result.matchName), failures.map((entry) => entry.matchName), remaining)) return INVALID;
  return { kind: "page", page: { requestId: ticket, host, results, failures, remaining, elapsedMs, cleanedUp } };
}

/** The answer to an instance read must be exactly the ticket asked for and the one effect named in it. */
export function parseCatalogueInstance(value: JsonValue, ticket: string, matchName: string): CatalogueInstanceOutcome {
  const early = unanswered(value, ticket);
  if (early !== "answered") return early;
  const body = decode(instanceBody, value);
  if (!body.ok || body.value.instance.matchName !== matchName) return INVALID;
  const { host, instance } = body.value;
  return { kind: "instance", read: { matchName: instance.matchName, displayName: instance.displayName, controls: instance.controls, truncated: instance.truncated, host } };
}

/** Whether the host refused the page before it touched anything: an answer with `ok` false and `mayHaveMutated` false. */
export function refusedBeforeStart(value: JsonValue): boolean {
  return decode(startedNothing, value).ok;
}
