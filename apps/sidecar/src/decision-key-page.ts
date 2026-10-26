// The key-entry page: one self-contained HTML document, no script and no external request, in the catalogue window's look. It never contains a key; the form posts to its own one-time address.
import { decisionFailureText, providerAsksFor, providersAskingFor, translatorFor, type DecisionFailureCode, type DecisionField, type Language, type Translate } from "@extynt/ui-text";
import { KEY_PAGE_SCRIPT } from "./decision-key-script.js";
import { KEY_PAGE_STYLE } from "./decision-key-style.js";
import { providerName } from "./decision-messages.js";
import { DECISION_PROVIDERS, type DecisionProvider } from "./decision-providers.js";
import type { DecisionShadow } from "./decision-settings-service.js";

interface EntryView {
  readonly language: Language;
  readonly action: string;
  readonly provider: DecisionProvider | null;
  readonly failure?: string | undefined;
  readonly disabled?: boolean | undefined;
}

interface ResultView {
  readonly language: Language;
  readonly provider: DecisionProvider;
  readonly ms: number;
  readonly shadowed: ReadonlyArray<DecisionShadow>;
}

type PageState = "stateEntry" | "stateSaved" | "stateExpired";

const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

function shell(language: Language, t: Translate, content: { readonly state: PageState; readonly heading: string; readonly body: string; readonly script?: string }): string {
  const tag = t(`settings.decision.page.${content.state}`);
  return `<!doctype html>
<html lang="${esc(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex">
<title>extynt · ${esc(t("settings.decision.name"))}</title><style>${KEY_PAGE_STYLE}</style></head>
<body><header class="band"><span class="eyebrow"><b>extynt</b> · ${esc(t("settings.decision.page.eyebrow"))}</span><h1>${esc(content.heading)}</h1><span class="state">${esc(tag)}</span></header>
<main>${content.body}</main>${content.script === undefined ? "" : `<script>${content.script}</script>`}</body></html>
`;
}

function providerOptions(t: Translate, chosen: DecisionProvider | null): string {
  return DECISION_PROVIDERS.map((provider) => `<option value="${provider}"${provider === chosen ? " selected" : ""}>${esc(providerName(t, provider))}</option>`).join("");
}

function field(label: string, input: string): string {
  return `<label><span>${esc(label)}</span>${input}</label>`;
}

function advancedFields(t: Translate, view: EntryView): string {
  const provider = view.provider ?? "jev";
  const labelled = (field: DecisionField, text: string, input: string): string => {
    const kinds = providersAskingFor(field).join(" ");
    return `<label data-for="${kinds}"${providerAsksFor(provider, field) ? "" : " hidden"}><span>${esc(text)}</span>${input}</label>`;
  };
  const open = provider !== "jev" || view.failure !== undefined ? " open" : "";
  return `<details${open}><summary>${esc(t("settings.decision.advanced"))}</summary>${[
    labelled("model", t("settings.decision.model"), '<input name="model" autocomplete="off" spellcheck="false" maxlength="200">'),
    labelled("baseUrl", t("settings.decision.baseUrl"), '<input name="baseUrl" autocomplete="off" spellcheck="false" maxlength="500" placeholder="https://">'),
    labelled("accountId", t("settings.decision.accountId"), '<input name="accountId" autocomplete="off" spellcheck="false" maxlength="200">'),
  ].join("")}</details>`;
}

/** The failed-test line: the provider, "test failed" and why, as the page shows it above the button. */
export function failureReceipt(t: Translate, provider: DecisionProvider, reason: string, code: DecisionFailureCode | null): string {
  const why = reason === "not-set-up" ? t("settings.decision.error.notSetUp", { provider: providerName(t, provider) }) : decisionFailureText(t, code ?? undefined, reason);
  return [providerName(t, provider), t("settings.decision.page.testFailed"), why].join(" · ");
}

function formOf(view: EntryView, t: Translate): string {
  const failed = view.failure !== undefined;
  const label = failed ? "settings.decision.page.retry" : "settings.model.save";
  const data = `data-retry="${esc(t("settings.decision.page.retry"))}" data-busy="${esc(t("settings.decision.status.testing"))}" data-network="${esc(t("settings.decision.status.saveFailed"))}"`;
  return `<form method="post" action="${esc(view.action)}" autocomplete="off" ${data}><fieldset${view.disabled === true ? " disabled" : ""}>
${field(t("settings.decision.provider"), `<select name="provider">${providerOptions(t, view.provider)}</select>`)}
${field(t("settings.decision.apiKey"), '<input type="password" name="apiKey" autocomplete="new-password" spellcheck="false" maxlength="2000" required>')}
${advancedFields(t, view)}
<div id="receipt" class="receipt bad" role="status"${failed ? "" : " hidden"}>${esc(view.failure ?? "")}</div>
<button type="submit">${esc(t(label))}</button></fieldset></form>`;
}

/** The form that takes the key: it tests the key before anything is saved and shows a failed test above the button. */
export function entryPage(view: EntryView): string {
  const t = translatorFor(view.language);
  const body = `<p>${esc(t("settings.decision.page.intro"))}</p>${formOf(view, t)}<p class="note">${esc(t("settings.decision.page.footnote"))}</p>`;
  return shell(view.language, t, { state: "stateEntry", heading: t("settings.decision.page.heading"), body, script: KEY_PAGE_SCRIPT });
}

function receiptOf(t: Translate, view: ResultView): string {
  const parts = [providerName(t, view.provider), t("settings.decision.page.savedWord"), t("settings.decision.page.connected"), t("settings.decision.page.testOk"), `${view.ms} ms`];
  return `<div class="receipt"><span class="ok">${esc(parts.join(" · "))}</span></div>`;
}

function shadowNotes(t: Translate, shadowed: ReadonlyArray<DecisionShadow>): string {
  return shadowed.map((item) => `<div class="warn">${esc(t("settings.decision.shadowed", { variable: item.variable, source: item.source }))}</div>`).join("");
}

/** The page after a successful save: the receipt line and, when it applies, the settings that did not win. */
export function resultPage(view: ResultView): string {
  const t = translatorFor(view.language);
  const body = `${receiptOf(t, view)}${shadowNotes(t, view.shadowed)}<p>${esc(t("settings.decision.page.saved"))}</p>`;
  return shell(view.language, t, { state: "stateSaved", heading: t("settings.decision.name"), body });
}

/** The page for a link that expired, was used or never existed: the same form, switched off, with one line saying why. */
export function expiredPage(language: Language): string {
  const t = translatorFor(language);
  const body = `<div class="warn" role="alert">${esc(t("settings.decision.page.expired"))}</div>${formOf({ language, action: "", provider: null, disabled: true }, t)}`;
  return shell(language, t, { state: "stateExpired", heading: t("settings.decision.page.heading"), body });
}
