// The capability catalogue's routes: starting and completing collection pages, and the headless render engine's run and progress.
import { array, decode, jsonValue, type JsonValue, object, optional, string } from "@extynt/decode";

import { jsonOf } from "@extynt/mcp-server";
import { accepted, refusedUncoded } from "./receiver-outcome.js";
import type { ReceiverOutcome } from "./receiver-types.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { interfaceLanguageOf } from "./ui-language.js";
import { requirePairedPanel } from "./server-paired-panel.js";
import { outcomeReply } from "./server-route-outcome.js";
import { jsonBody, uniformBody } from "./server-route-body.js";
import { bodyRoute, ok, answer, refuse, route, type MountedRoute } from "./server-route-table.js";
import { errorEnvelope } from "./server-http-wire.js";
import type { Opaque } from "./snapshot-view.js";

const COMPLETION_BODY_LIMIT_BYTES = 2_000_000;
const ENGINE_BODY_LIMIT_BYTES = 4_096;
const TICKET_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ENGINE_YEAR_PATTERN = /^20\d\d$/;
const CODE_PATTERN = /^[A-Z_]{1,64}$/;

const catalogueCompletion = object({ ticket: string({ pattern: TICKET_PATTERN }), page: jsonValue });
const REFUSED_COMPLETION = { status: 409, code: "CATALOGUE_COMPLETION_FAILED", message: "The catalogue page was not accepted; nothing was recorded." } as const;
const INVALID_COMPLETION = { status: 409, code: "INVALID_CATALOGUE_COMPLETION", message: REFUSED_COMPLETION.message } as const;
const engineRequest = object({ years: optional(array(string())) });

function releaseTicket(deps: HttpRoutesDeps, ticket: string): void {
  if (deps.state.inFlight?.kind === "catalogue_page" && deps.state.inFlight.id === ticket) deps.state.inFlight = undefined;
}

function catalogueFailure(deps: HttpRoutesDeps, ticket: string | undefined, error: Error): ReceiverOutcome {
  if (ticket) releaseTicket(deps, ticket);
  const code = CODE_PATTERN.test(error.message) ? error.message : "CATALOGUE_COMPLETION_FAILED";
  return refusedUncoded(409, errorEnvelope(code, "The catalogue page was not accepted; nothing was recorded."));
}

function invalidCatalogueCompletion(deps: HttpRoutesDeps): ReceiverOutcome {
  return catalogueFailure(deps, undefined, new Error("INVALID_CATALOGUE_COMPLETION"));
}

function completeCatalogue(deps: HttpRoutesDeps, completion: { readonly ticket: string; readonly page: JsonValue }): ReceiverOutcome {
  try {
    const result = deps.state.catalogue.complete(completion.ticket, completion.page);
    releaseTicket(deps, completion.ticket);
    deps.dispatch.notifyChange();
    return accepted(200, { ...result, progress: jsonOf(deps.state.catalogue.progress()) });
  } catch (error) {
    return catalogueFailure(deps, completion.ticket, error instanceof Error ? error : new Error("CATALOGUE_COMPLETION_FAILED"));
  }
}

function startCatalogue(deps: HttpRoutesDeps): ReceiverOutcome {
  const result = deps.state.catalogue.start();
  if ("ok" in result) return refusedUncoded(409, errorEnvelope(result.code, "No host census has arrived yet; the catalogue starts after the panel's first census."));
  deps.dispatch.notifyChange();
  return accepted(200, { ok: true, progress: jsonOf(result) });
}

/** The catalogue receiver the native host lane calls: `start` clears a pause and `complete` takes a page; a completion in any other shape is refused. */
export function acceptCatalogue(deps: HttpRoutesDeps, action: "start" | "complete", body: Opaque): ReceiverOutcome {
  if (action === "start") return startCatalogue(deps);
  const completion = decode(catalogueCompletion, body);
  return completion.ok ? completeCatalogue(deps, completion.value) : invalidCatalogueCompletion(deps);
}

const engineUnavailable = refuse(409, "ENGINE_UNAVAILABLE", "This sidecar has no headless render engine (the native host lane is off).");

/** The catalogue routes: `start` clears a pause, `complete` takes a page for a ticket (paired panel only), and `engine` runs the headless render engine over every installed After Effects (POST answers at once; GET is its progress); both answers carry `language`, the interface language the Windows catalogue window speaks. */
export const catalogueRoutes: readonly MountedRoute[] = [
  route({ method: "POST", path: "/v1/catalogue/start", handle: ({ deps }) => outcomeReply(startCatalogue(deps)) }),
  bodyRoute({
    method: "POST",
    path: "/v1/catalogue/complete",
    guard: requirePairedPanel("Catalogue pages require the paired panel instance."),
    body: jsonBody(catalogueCompletion, COMPLETION_BODY_LIMIT_BYTES, INVALID_COMPLETION, { tooLarge: REFUSED_COMPLETION, notJson: REFUSED_COMPLETION }),
    handle: ({ deps, body }) => outcomeReply(completeCatalogue(deps, body)),
  }),
  route({ method: "GET", path: "/v1/catalogue/engine", handle: ({ deps }) => (deps.state.catalogueEngine ? ok({ ok: true, language: interfaceLanguageOf(deps.state), engine: deps.state.catalogueEngine.status() }) : engineUnavailable) }),
  bodyRoute({
    method: "POST",
    path: "/v1/catalogue/engine",
    body: { ...uniformBody(engineRequest, ENGINE_BODY_LIMIT_BYTES, { status: 400, code: "INVALID_JSON", message: "The request must be a JSON object with an optional years list." }), emptyAsObject: true },
    handle: ({ deps, body }) => {
      const engine = deps.state.catalogueEngine;
      if (!engine) return engineUnavailable;
      void engine.collect(body.years?.filter((year) => ENGINE_YEAR_PATTERN.test(year)));
      return answer(202, { ok: true, language: interfaceLanguageOf(deps.state), engine: engine.status() });
    },
  }),
];
