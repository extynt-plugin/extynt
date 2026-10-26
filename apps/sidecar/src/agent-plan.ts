// Turns a tool result into the text the model reads and a plan-producing result into the card the panel shows. Plan data is foreign (host and model written), so every field is decoded leniently: what does not fit is dropped or bounded, never repaired.
import { decode, fallback, literal, map, number, object, optional, skippingInvalid, string, type Decoder, type Infer } from "@extynt/decode";
import { toMcpToolResult } from "@extynt/mcp-server";
import { identityDigest, MIN_PER_RESULT_CHARS, MAX_CARD_OPERATIONS, MAX_CARD_TITLE_CHARS, MAX_CARD_WARNINGS, MAX_CARD_NOTICES, MAX_CARD_NOTICE_INDEXES, MAX_CARD_NOTICE_CHARS, MAX_CARD_PATH_CHARS, MAX_CARD_EXPRESSION_CHARS, clean } from "./agent-policy.js";
import type { AgentToolCall } from "@extynt/llm";
import type { ToolResult, AgentPlanCard, AgentPlanNotice, AgentPlanRow } from "./agent-types.js";

interface PresentedValue {
  readonly label: string | null;
  readonly target: string | null;
  readonly before: string | null;
  readonly after: string | null;
}

interface PlanExpression {
  propertyPath: string;
  source: string;
}

const PLACEHOLDER_ROW_LABEL = /^Operation \d+$/;

const textOrUndefined: Decoder<string | undefined> = { run: (input) => (typeof input === "string" ? input : undefined) };
const textOrEmpty: Decoder<string> = { run: (input) => (typeof input === "string" ? input : "") };
const nonEmptyTextOrNull: Decoder<string | null> = { run: (input) => (typeof input === "string" && input !== "" ? input : null) };
const flagOrUndefined: Decoder<boolean | undefined> = { run: (input) => (typeof input === "boolean" ? input : undefined) };
const labelOrUndefined: Decoder<string | undefined> = { run: (input) => (typeof input === "string" || typeof input === "number" || typeof input === "boolean" ? String(input) : undefined) };

const boundedText = (maxChars: number): Decoder<string> => ({ run: (input) => (typeof input === "string" ? clean(input, maxChars).slice(0, maxChars) : "") });

function orNothing<T>(decoder: Decoder<T>): Decoder<T | undefined> {
  return {
    run: (input) => {
      const decoded = decode(decoder, input);
      return decoded.ok ? decoded.value : undefined;
    },
  };
}

function listOrNothing<T>(item: Decoder<T>): Decoder<ReadonlyArray<T> | undefined> {
  return fallback(skippingInvalid(item), undefined);
}

function tolerantList<T>(item: Decoder<T>): Decoder<ReadonlyArray<T>> {
  return fallback(skippingInvalid(item), []);
}

const presentedValue = object({ label: nonEmptyTextOrNull, target: nonEmptyTextOrNull, before: nonEmptyTextOrNull, after: nonEmptyTextOrNull });

const planNotice = map(
  object({
    severity: literal("note", "unverified", "error"),
    title: boundedText(MAX_CARD_NOTICE_CHARS.title),
    detail: boundedText(MAX_CARD_NOTICE_CHARS.detail),
    because: boundedText(MAX_CARD_NOTICE_CHARS.because),
    action: boundedText(MAX_CARD_NOTICE_CHARS.action),
    operationIndexes: tolerantList(number()),
    code: boundedText(MAX_CARD_NOTICE_CHARS.code),
  }),
  (notice): AgentPlanNotice => ({
    severity: notice.severity,
    title: notice.title,
    detail: notice.detail,
    ...(notice.because ? { because: notice.because } : {}),
    ...(notice.action ? { action: notice.action } : {}),
    ...(notice.operationIndexes.length ? { operationIndexes: notice.operationIndexes.slice(0, MAX_CARD_NOTICE_INDEXES) } : {}),
    ...(notice.code ? { code: notice.code } : {}),
  }),
);

const planExpression = map(
  object({ source: string({ nonEmpty: true }), propertyPath: textOrUndefined }),
  (expression): PlanExpression => ({
    propertyPath: (expression.propertyPath ?? "").slice(0, MAX_CARD_PATH_CHARS),
    source: expression.source.length > MAX_CARD_EXPRESSION_CHARS ? `${expression.source.slice(0, MAX_CARD_EXPRESSION_CHARS - 1)}…` : expression.source,
  }),
);

const shownFields = object({
  title: textOrUndefined,
  values: tolerantList(presentedValue),
  warnings: tolerantList(string()),
  notices: tolerantList(planNotice),
});

const planPresentation = object({
  title: textOrUndefined,
  values: tolerantList(presentedValue),
  warnings: tolerantList(string()),
  notices: tolerantList(planNotice),
  shown: optional(orNothing(shownFields)),
  expressions: tolerantList(planExpression),
  verification: orNothing(object({ requiresAcknowledgement: flagOrUndefined })),
});

const operationLabels = listOrNothing(map(object({ type: labelOrUndefined, operation: labelOrUndefined }), (entry) => entry.type ?? entry.operation ?? ""));

const planSourceFields = object({
  planId: optional(textOrUndefined),
  summary: optional(textOrUndefined),
  presentation: optional(orNothing(planPresentation)),
  operations: optional(operationLabels),
  plan: optional(orNothing(object({ operations: operationLabels }))),
});

const titleHints = object({ summary: textOrUndefined, request: textOrUndefined });

type PlanSource = Infer<typeof planSourceFields>;

const NO_PRESENTATION: NonNullable<PlanSource["presentation"]> = { title: undefined, values: [], warnings: [], notices: [], expressions: [], verification: undefined, shown: undefined };

function withShownText(presentation: NonNullable<PlanSource["presentation"]>): NonNullable<PlanSource["presentation"]> {
  const { shown } = presentation;
  return shown ? { ...presentation, title: shown.title ?? presentation.title, values: shown.values, warnings: shown.warnings, notices: shown.notices } : presentation;
}

function planSourceOf(data: ToolResult["data"], sealed: ToolResult["data"]): PlanSource | undefined {
  const base = decode(planSourceFields, data);
  const extra = decode(planSourceFields, sealed);
  if (!base.ok && !extra.ok) return undefined;
  const merged = { ...(base.ok ? base.value : {}), ...(extra.ok ? extra.value : {}) };
  return merged.presentation ? { ...merged, presentation: withShownText(merged.presentation) } : merged;
}

function planTitle(source: PlanSource, planId: string, hints: AgentToolCall["arguments"]): string {
  const written = decode(titleHints, hints);
  const { summary, request } = written.ok ? written.value : { summary: undefined, request: undefined };
  return source.presentation?.title ?? source.summary ?? summary ?? request ?? planId;
}

function presentedRow(value: PresentedValue): AgentPlanRow | undefined {
  if (!value.label || PLACEHOLDER_ROW_LABEL.test(value.label)) return undefined;
  return { label: value.label.slice(0, MAX_CARD_PATH_CHARS), ...(value.target ? { target: value.target.slice(0, MAX_CARD_PATH_CHARS) } : {}), before: value.before, after: value.after };
}

function rowLine(row: AgentPlanRow): string {
  const change = row.before && row.after ? `${row.before} → ${row.after}` : (row.after ?? row.before);
  const where = row.target && row.target !== row.before ? ` (${row.target})` : "";
  return `${row.label}${change ? `: ${change}` : ""}${where}`;
}

function operationLine(value: PresentedValue): string {
  const row = presentedRow(value);
  return row ? rowLine(row) : [value.before, value.after].filter(Boolean).join(" · ");
}

function planRows(source: PlanSource): AgentPlanRow[] {
  const rows = (source.presentation?.values ?? []).slice(0, MAX_CARD_OPERATIONS).map(presentedRow);
  return rows.filter((row): row is AgentPlanRow => row !== undefined);
}

function planOperations(source: PlanSource): string[] {
  const presented = (source.presentation?.values ?? []).slice(0, MAX_CARD_OPERATIONS).map(operationLine).filter(Boolean);
  if (presented.length) return presented;
  return (source.plan?.operations ?? source.operations ?? []).slice(0, MAX_CARD_OPERATIONS).filter(Boolean);
}

function cardDisclosures(presentation: PlanSource["presentation"]): Pick<AgentPlanCard, "warnings" | "notices" | "expressions" | "requiresAcknowledgement"> {
  const { warnings, notices, expressions, verification } = presentation ?? NO_PRESENTATION;
  return {
    warnings: warnings.slice(0, MAX_CARD_WARNINGS),
    notices: notices.slice(0, MAX_CARD_NOTICES),
    expressions: expressions.map((expression) => ({ ...expression })),
    requiresAcknowledgement: verification?.requiresAcknowledgement !== false,
  };
}

/**
 * The card the panel shows for a plan-producing tool result, or undefined when the result carries no plan id. `data` is the
 * tool's result and `sealed` the plan the sidecar sealed after it; fields in `sealed` win. Each change is one line, "Opacity:
 * 100 → 55 (WOODEN_CRATE)", with a side the project did not give left out and a target that is the value being changed not
 * said twice; a plan stored before value rows existed keeps its operation types and gets no rows. A notice whose severity
 * the panel has no icon for is dropped, order is kept, and every string is bounded so a verbose result cannot blow up the
 * card; `warnings` rides alongside the notices for a panel that predates them.
 */
export function planCard(data: ToolResult["data"], args: AgentToolCall["arguments"], sealed?: ToolResult["data"], autoApply = false): AgentPlanCard | undefined {
  const source = planSourceOf(data, sealed);
  const planId = source?.planId;
  if (!source || planId === undefined) return undefined;
  const rows = planRows(source);
  return {
    planId,
    title: planTitle(source, planId, args).slice(0, MAX_CARD_TITLE_CHARS),
    operations: planOperations(source),
    ...(rows.length ? { rows } : {}),
    ...cardDisclosures(source.presentation),
    autoApply,
  };
}

const toolContent = object({ content: tolerantList(object({ type: literal("text"), text: textOrEmpty })) });

/** The text the model reads for a tool result: the MCP-shaped text parts joined, cut at `charCap` with a note naming the layers past the cut so they stay addressable. */
export function toolResultText(result: ToolResult, charCap: number = MIN_PER_RESULT_CHARS, memory?: { lastView: Map<string, string> }): string {
  const shaped = decode(toolContent, toMcpToolResult(result, memory ? { memory } : {}));
  const text = shaped.ok ? shaped.value.content.map((part) => part.text).join("\n") : "";
  if (text.length <= charCap) return text;
  const dropped = identityDigest(text.slice(charCap));
  const kept = dropped ? ` Past the cut it also named: ${dropped}.` : "";
  return `${text.slice(0, charCap)}… [truncated; narrow the query or page with a cursor.${kept}]`;
}
