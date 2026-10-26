// Turns a decision-model change into the new contents of llm.env: pure, so the route, the key page and the tests share one set of rules. A key is only ever copied from the request into the file.
import { array, decodeJson, presentFields } from "@extynt/decode";
import { decisionModelEntry, encodeDecisionModelEntries, type DecisionModelEntry } from "@extynt/decide";
import { defaultModelOf, ENTRIES_VARIABLE, JEV_VARIABLES, keyVariableOf, type DecisionProvider } from "./decision-providers.js";
import type { EnvValues } from "./llm-env-file.js";

/** What a person or an agent asks to set: an empty text resets that setting to its default, an absent one leaves it alone. */
export interface DecisionSet {
  readonly provider: DecisionProvider;
  readonly apiKey?: string | undefined;
  readonly model?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly accountId?: string | undefined;
  readonly keyVariable?: string | undefined;
}

/** Why a change cannot be written; the field names which setting is at fault. */
export type DecisionIssue =
  | { readonly code: "missing"; readonly field: "key" | "model" | "baseUrl" | "accountId" }
  | { readonly code: "singleLine"; readonly field: string }
  | { readonly code: "fileInvalid" };

/** The new file contents with the variables that were written or removed, or the issue that stopped the change. */
export type DecisionWrite =
  | { readonly ok: true; readonly values: EnvValues; readonly touched: ReadonlyArray<string> }
  | { readonly ok: false; readonly issue: DecisionIssue };

type Effective = Readonly<Record<string, string | undefined>>;

const VARIABLE_NAME = /^[A-Z][A-Z0-9_]*$/;

function withValue(values: Record<string, string>, name: string, text: string | undefined): void {
  if (text === undefined) return;
  if (text === "") delete values[name];
  else values[name] = text;
}

function multiLine(update: DecisionSet): string | undefined {
  const fields = [["key", update.apiKey], ["model", update.model], ["baseUrl", update.baseUrl], ["accountId", update.accountId], ["keyVariable", update.keyVariable]] as const;
  return fields.find(([, text]) => text !== undefined && /[\r\n]/.test(text))?.[0];
}

function jevWrite(values: EnvValues, update: DecisionSet, effective: Effective): DecisionWrite {
  if (update.apiKey === undefined && (effective[JEV_VARIABLES.key] ?? "") === "") return { ok: false, issue: { code: "missing", field: "key" } };
  const next: Record<string, string> = { ...values };
  withValue(next, JEV_VARIABLES.key, update.apiKey);
  withValue(next, JEV_VARIABLES.model, update.model);
  withValue(next, JEV_VARIABLES.baseUrl, update.baseUrl);
  return { ok: true, values: next, touched: Object.values(JEV_VARIABLES) };
}

type GenericProvider = Exclude<DecisionProvider, "jev">;

interface EntryFields {
  readonly model: string;
  readonly baseUrl: string;
  readonly accountId: string;
  readonly keyVariable: string;
}

function listOf(values: EnvValues): ReadonlyArray<DecisionModelEntry> | undefined {
  const text = values[ENTRIES_VARIABLE];
  if (text === undefined || text.trim() === "") return [];
  const parsed = decodeJson(text, array(decisionModelEntry));
  return parsed.ok ? parsed.value : undefined;
}

function entryNamed(list: ReadonlyArray<DecisionModelEntry>, id: string): DecisionModelEntry | undefined {
  return list.find((item) => item.id === id);
}

function currentFields(existing: DecisionModelEntry | undefined): EntryFields {
  if (existing === undefined) return { model: "", baseUrl: "", accountId: "", keyVariable: "" };
  const cloud = existing.dialect === "cloudflare";
  return { model: existing.model, baseUrl: cloud ? "" : existing.baseUrl ?? "", accountId: cloud ? existing.accountId : "", keyVariable: existing.keyEnv ?? "" };
}

function pick(given: string | undefined, existing: string, defaultText: string): string {
  const text = given ?? existing;
  return text === "" ? defaultText : text;
}

function fieldsOf(update: DecisionSet, existing: DecisionModelEntry | undefined): EntryFields {
  const old = currentFields(existing);
  return {
    model: pick(update.model, old.model, defaultModelOf(update.provider)),
    baseUrl: pick(update.baseUrl, old.baseUrl, ""),
    accountId: pick(update.accountId, old.accountId, ""),
    keyVariable: pick(update.keyVariable, old.keyVariable, keyVariableOf(update.provider)),
  };
}

function missingField(provider: DecisionProvider, fields: EntryFields): "model" | "baseUrl" | "accountId" | undefined {
  if (fields.model === "") return "model";
  if (provider === "systemone" && fields.baseUrl === "") return "baseUrl";
  return provider === "cloudflare" && fields.accountId === "" ? "accountId" : undefined;
}

function openAiEntry(fields: EntryFields, existing: DecisionModelEntry | undefined): DecisionModelEntry {
  const old = existing?.dialect === "openai" ? existing : undefined;
  return {
    dialect: "openai", id: "openai", model: fields.model, keyEnv: fields.keyVariable,
    ...presentFields({ baseUrl: fields.baseUrl === "" ? undefined : fields.baseUrl, threshold: old?.threshold, calibrated: old?.calibrated, acceptsImages: old?.acceptsImages }),
  };
}

function cloudflareEntry(fields: EntryFields, existing: DecisionModelEntry | undefined): DecisionModelEntry {
  const old = existing?.dialect === "cloudflare" ? existing : undefined;
  return { dialect: "cloudflare", id: "cloudflare", accountId: fields.accountId, model: fields.model, keyEnv: fields.keyVariable, ...presentFields({ gateway: old?.gateway }) };
}

function systemOneEntry(fields: EntryFields, existing: DecisionModelEntry | undefined): DecisionModelEntry {
  const old = existing?.dialect === "systemone" ? existing : undefined;
  return { dialect: "systemone", id: "systemone", baseUrl: fields.baseUrl, model: fields.model, keyEnv: fields.keyVariable, ...presentFields({ threshold: old?.threshold, calibrated: old?.calibrated }) };
}

function entryOf(provider: GenericProvider, fields: EntryFields, existing: DecisionModelEntry | undefined): DecisionModelEntry {
  if (provider === "openai") return openAiEntry(fields, existing);
  return provider === "cloudflare" ? cloudflareEntry(fields, existing) : systemOneEntry(fields, existing);
}

function genericWrite(values: EnvValues, update: DecisionSet & { readonly provider: GenericProvider }, effective: Effective): DecisionWrite {
  const list = listOf(values);
  if (list === undefined) return { ok: false, issue: { code: "fileInvalid" } };
  const existing = entryNamed(list, update.provider);
  const fields = fieldsOf(update, existing);
  const missing = missingField(update.provider, fields);
  if (missing !== undefined) return { ok: false, issue: { code: "missing", field: missing } };
  if (!VARIABLE_NAME.test(fields.keyVariable)) return { ok: false, issue: { code: "singleLine", field: "keyVariable" } };
  const keyKnown = update.apiKey !== undefined || (effective[fields.keyVariable] ?? "") !== "";
  if (!keyKnown && update.provider !== "systemone") return { ok: false, issue: { code: "missing", field: "key" } };
  const next: Record<string, string> = { ...values };
  withValue(next, fields.keyVariable, update.apiKey);
  const others = list.filter((item) => item.id !== update.provider);
  next[ENTRIES_VARIABLE] = encodeDecisionModelEntries([...others, entryOf(update.provider, fields, existing)]);
  return { ok: true, values: next, touched: [ENTRIES_VARIABLE, fields.keyVariable] };
}

/** The file contents with this provider set up as asked; the key is written to its own variable, never into the list. */
export function setDecision(values: EnvValues, update: DecisionSet, effective: Effective): DecisionWrite {
  const field = multiLine(update);
  if (field !== undefined) return { ok: false, issue: { code: "singleLine", field } };
  const { provider } = update;
  return provider === "jev" ? jevWrite(values, update, effective) : genericWrite(values, { ...update, provider }, effective);
}

function clearJev(values: EnvValues): DecisionWrite {
  const next: Record<string, string> = { ...values };
  for (const name of Object.values(JEV_VARIABLES)) delete next[name];
  return { ok: true, values: next, touched: Object.values(JEV_VARIABLES) };
}

function clearGeneric(values: EnvValues, provider: DecisionProvider): DecisionWrite {
  const list = listOf(values);
  if (list === undefined) return { ok: false, issue: { code: "fileInvalid" } };
  const keyVariable = entryNamed(list, provider)?.keyEnv ?? "";
  const next: Record<string, string> = { ...values };
  const rest = list.filter((item) => item.id !== provider);
  if (rest.length === 0) delete next[ENTRIES_VARIABLE];
  else next[ENTRIES_VARIABLE] = encodeDecisionModelEntries(rest);
  if (keyVariable === keyVariableOf(provider)) delete next[keyVariable];
  return { ok: true, values: next, touched: [ENTRIES_VARIABLE, keyVariable] };
}

/** The file contents without this provider and the key that was stored for it; a key the person named from the environment is left alone. */
export function clearDecision(values: EnvValues, provider: DecisionProvider): DecisionWrite {
  return provider === "jev" ? clearJev(values) : clearGeneric(values, provider);
}
