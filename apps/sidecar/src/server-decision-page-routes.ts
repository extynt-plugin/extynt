// The one-time key-entry page: open routes because the token in the path is the credential. A form post from another origin is refused, and neither the page nor its logs ever hold a key.
import type { IncomingMessage } from "node:http";
import { decode, decodeJson, record, string } from "@extynt/decode";
import { keyLinksFor, type KeyAccepted } from "./decision-link.js";
import { KEY_PAGE_SCRIPT_SOURCE } from "./decision-key-script.js";
import { entryPage, expiredPage, failureReceipt, resultPage } from "./decision-key-page.js";
import { issueMessage } from "./decision-messages.js";
import { decisionChange } from "./decision-settings-apply.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { readBody } from "./server-http-wire.js";
import { refuse, route, STREAMED, type Exchange, type MountedRoute } from "./server-route-table.js";
import { uiEventsFor } from "./ui-events.js";
import { interfaceLanguageOf, translatorOf } from "./ui-language.js";

const MAX_FORM_BYTES = 16_000;
const PAGE_PATH = "/decision-key/:token";
const PAGE_POLICY = `default-src 'none'; style-src 'unsafe-inline'; script-src ${KEY_PAGE_SCRIPT_SOURCE}; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;

function sendHtml(deps: HttpRoutesDeps, exchange: Exchange, page: { readonly status: number; readonly html: string }): typeof STREAMED {
  const { response, context } = exchange;
  const bytes = Buffer.byteLength(page.html);
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Content-Length", bytes);
  response.setHeader("Content-Security-Policy", PAGE_POLICY);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.statusCode = page.status;
  response.end(page.html);
  deps.dispatch.emit(context, "response", "request.completed", { outcome: page.status < 400 ? "succeeded" : "rejected", statusCode: page.status, bytes });
  return STREAMED;
}

function actionOf(token: string): string {
  return `/decision-key/${token}`;
}

function sameOrigin(deps: HttpRoutesDeps, request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  const site = request.headers["sec-fetch-site"];
  if (site === "cross-site" || site === "same-site") return false;
  if (origin === undefined) return true;
  const port = deps.state.port ?? 0;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function showForm(deps: HttpRoutesDeps, exchange: Exchange, token: string): typeof STREAMED {
  const language = interfaceLanguageOf(deps.state);
  const link = keyLinksFor(deps.state, () => deps.state.now().getTime()).peek(token);
  if (link === null) return sendHtml(deps, exchange, { status: 410, html: expiredPage(language) });
  if (link.accepted !== null) return sendHtml(deps, exchange, { status: 200, html: resultPage({ language, ...link.accepted }) });
  return sendHtml(deps, exchange, { status: 200, html: entryPage({ language, action: actionOf(token), provider: link.provider }) });
}

async function bodyOf(request: IncomingMessage): Promise<Readonly<Record<string, string>>> {
  try {
    const text = await readBody(request, MAX_FORM_BYTES);
    if (request.headers["content-type"]?.startsWith("application/json") !== true) return Object.fromEntries([...new URLSearchParams(text)].filter(([, field]) => field.trim() !== "").map(([name, field]) => [name, field.trim()]));
    const decoded = decodeJson(text, record(string(), string()));
    return decoded.ok ? decoded.value : {};
  } catch {
    return {};
  }
}

function sendJson(deps: HttpRoutesDeps, exchange: Exchange, status: number, reply: { readonly ok: boolean; readonly next?: string; readonly receipt?: string }): typeof STREAMED {
  const { response, context } = exchange;
  const text = JSON.stringify(reply);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.statusCode = status;
  response.end(text);
  deps.dispatch.emit(context, "response", "request.completed", { outcome: status < 400 ? "succeeded" : "rejected", statusCode: status, bytes: Buffer.byteLength(text) });
  return STREAMED;
}

interface Verdict {
  readonly status: number;
  readonly failure: string | null;
  readonly accepted: KeyAccepted | null;
}

async function verdictOf(deps: HttpRoutesDeps, token: string, fields: Readonly<Record<string, string>>): Promise<Verdict> {
  const links = keyLinksFor(deps.state, () => deps.state.now().getTime());
  const settings = deps.state.options.decisionSettings;
  const t = translatorOf(deps.state);
  if (!settings || !links.attempt(token)) return { status: 410, failure: t("settings.decision.page.expired"), accepted: null };
  const decoded = decode(decisionChange, { ...fields, action: "set" });
  if (!decoded.ok) return { status: 422, failure: t("failure.settings.notUnderstood"), accepted: null };
  const tried = await settings.saveTested(decoded.value);
  if (tried.ok) return { status: 200, failure: null, accepted: { provider: decoded.value.provider, ms: tried.ms, shadowed: tried.applied.shadowed } };
  if ("issue" in tried) return { status: 422, failure: issueMessage(t, tried.issue, decoded.value.provider), accepted: null };
  return { status: 422, failure: failureReceipt(t, decoded.value.provider, tried.reason, tried.code), accepted: null };
}

async function saveForm(deps: HttpRoutesDeps, exchange: Exchange, token: string): Promise<ReturnType<typeof refuse> | typeof STREAMED> {
  const { request } = exchange;
  if (!sameOrigin(deps, request)) { request.resume(); return refuse(403, "FORBIDDEN_ORIGIN", "This form accepts posts from its own page only."); }
  const verdict = await verdictOf(deps, token, await bodyOf(request));
  const wantsJson = request.headers.accept?.includes("application/json") === true;
  if (verdict.accepted !== null) {
    keyLinksFor(deps.state, () => deps.state.now().getTime()).accept(token, verdict.accepted);
    uiEventsFor(deps.state).publish({ type: "decision", reason: "changed" });
    if (wantsJson) return sendJson(deps, exchange, 200, { ok: true, next: actionOf(token) });
    return sendHtml(deps, exchange, { status: 200, html: resultPage({ language: interfaceLanguageOf(deps.state), ...verdict.accepted }) });
  }
  const failure = verdict.failure ?? "";
  if (wantsJson) return sendJson(deps, exchange, verdict.status, { ok: false, receipt: failure });
  const language = interfaceLanguageOf(deps.state);
  const html = verdict.status === 410 ? expiredPage(language) : entryPage({ language, action: actionOf(token), provider: null, failure });
  return sendHtml(deps, exchange, { status: verdict.status, html });
}

const showPage = route({
  method: "GET",
  path: PAGE_PATH,
  open: true,
  handle: ({ deps, param, ...exchange }) => showForm(deps, exchange, param),
});

const savePage = route({
  method: "POST",
  path: PAGE_PATH,
  open: true,
  readsRequest: true,
  handle: ({ deps, param, ...exchange }) => saveForm(deps, exchange, param),
});

/** The key-entry page and its form post. */
export const decisionPageRoutes: readonly MountedRoute[] = [showPage, savePage];
