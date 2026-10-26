// The typed shape of one HTTP route: method, path, optional body decoder and a handler that returns a typed reply, mounted behind one call that matches and answers a request.
import type { IncomingMessage, ServerResponse } from "node:http";

import { jsonOf } from "@extynt/mcp-server";
import type { DiagnosticOutcome } from "./diagnostics.js";
import { readDecoded, type BodySpec, type Refusal } from "./server-route-body.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { errorEnvelope } from "./server-http-wire.js";
import type { RequestContext } from "./server-types.js";

type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A JSON answer whose body type is the route's own. */
export interface JsonAnswer<Answer> {
  readonly kind: "answer";
  readonly status: number;
  readonly body: Answer;
  readonly outcome: DiagnosticOutcome;
  readonly errorCode?: string;
  readonly bytes?: number;
}

/** A refusal answered with the standard error envelope. */
export interface RefusalAnswer {
  readonly kind: "refusal";
  readonly refusal: Refusal;
}

interface StreamedAnswer {
  readonly kind: "streamed";
}

export type RouteReply<Answer> = JsonAnswer<Answer> | RefusalAnswer | StreamedAnswer;

/** The parts of one HTTP exchange a route may need: the raw request and response, the diagnostic context and the parsed URL. */
export interface Exchange {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly context: RequestContext;
  readonly url: URL;
}

/** What a handler receives: the dependencies, the exchange, the decoded body with its size, and the `:param` path segment (empty when the path has none). */
export interface RouteCall<Body> extends Exchange {
  readonly deps: HttpRoutesDeps;
  readonly body: Body;
  readonly bytes: number;
  readonly param: string;
}

/** Decides before the body is read whether a request may proceed: a refusal answers it instead. */
export type RouteGuard = (deps: HttpRoutesDeps, exchange: Exchange) => Refusal | null;

interface BodylessRoute<Answer> {
  readonly method: RouteMethod;
  readonly path: string;
  readonly open?: true;
  readonly readsRequest?: true;
  readonly guard?: RouteGuard;
  readonly handle: (call: RouteCall<undefined>) => RouteReply<Answer> | Promise<RouteReply<Answer>>;
}

interface BodyRoute<Body, Answer> {
  readonly method: RouteMethod;
  readonly path: string;
  readonly guard?: RouteGuard;
  readonly body: BodySpec<Body> | ((deps: HttpRoutesDeps) => BodySpec<Body>);
  readonly handle: (call: RouteCall<Body>) => RouteReply<Answer> | Promise<RouteReply<Answer>>;
}

/** A route with its types erased behind one call that answers a request. */
export interface MountedRoute {
  readonly method: RouteMethod;
  readonly path: string;
  readonly open: boolean;
  param(method: string, pathname: string): string | null;
  serve(deps: HttpRoutesDeps, exchange: Exchange, param: string): Promise<void>;
}

/** A JSON answer with the given status. */
export function answer<Answer>(status: number, body: Answer, outcome: DiagnosticOutcome = "succeeded"): JsonAnswer<Answer> {
  return { kind: "answer", status, body, outcome };
}

/** A JSON answer that refuses the request with a body of the route's own, tagged with its diagnostic error code. */
export function rejected<Answer>(status: number, body: Answer, errorCode: string): JsonAnswer<Answer> {
  return { ...answer(status, body, "rejected"), errorCode };
}

/** A 200 answer for a request that succeeded. */
export function ok<Answer>(body: Answer): JsonAnswer<Answer> {
  return answer(200, body);
}

/** A refusal with the standard envelope. */
export function refuse(status: number, code: string, message: string): RefusalAnswer {
  return { kind: "refusal", refusal: { status, code, message } };
}

/** The reply of a handler that wrote the response itself. */
export const STREAMED: StreamedAnswer = { kind: "streamed" };

function respondRefusal(deps: HttpRoutesDeps, exchange: Exchange, refusal: Refusal): void {
  deps.dispatch.respond({ response: exchange.response, context: exchange.context, statusCode: refusal.status, value: { ...errorEnvelope(refusal.code, refusal.message), ...refusal.alongside }, outcome: "rejected", errorCode: refusal.code });
}

function write<Answer>(deps: HttpRoutesDeps, exchange: Exchange, reply: RouteReply<Answer>): void {
  if (reply.kind === "streamed") return;
  if (reply.kind === "refusal") { respondRefusal(deps, exchange, reply.refusal); return; }
  deps.dispatch.respond({ response: exchange.response, context: exchange.context, statusCode: reply.status, value: jsonOf(reply.body), outcome: reply.outcome, ...(reply.errorCode === undefined ? {} : { errorCode: reply.errorCode }), ...(reply.bytes === undefined ? {} : { bytes: reply.bytes }) });
}

function paramMatcher(path: string): (pathname: string) => string | null {
  if (!path.includes("/:")) return (pathname) => (pathname === path ? "" : null);
  const pattern = new RegExp(`^${path.replace(/:[A-Za-z]+/, "([^/]+)")}$`);
  return (pathname) => pattern.exec(pathname)?.[1] ?? null;
}

function mount(identity: { method: RouteMethod; path: string; open: boolean }, serve: MountedRoute["serve"]): MountedRoute {
  const match = paramMatcher(identity.path);
  return { ...identity, param: (method, pathname) => (method === identity.method ? match(pathname) : null), serve };
}

function refusedByGuard(guard: RouteGuard | undefined, deps: HttpRoutesDeps, exchange: Exchange): boolean {
  const refusal = guard?.(deps, exchange) ?? null;
  if (refusal === null) return false;
  exchange.request.resume();
  respondRefusal(deps, exchange, refusal);
  return true;
}

async function serveBodyless<Answer>(spec: BodylessRoute<Answer>, deps: HttpRoutesDeps, exchange: Exchange, param: string): Promise<void> {
  if (refusedByGuard(spec.guard, deps, exchange)) return;
  if (spec.readsRequest !== true) exchange.request.resume();
  write(deps, exchange, await spec.handle({ ...exchange, deps, body: undefined, bytes: 0, param }));
}

async function serveWithBody<Body, Answer>(spec: BodyRoute<Body, Answer>, deps: HttpRoutesDeps, exchange: Exchange, param: string): Promise<void> {
  if (refusedByGuard(spec.guard, deps, exchange)) return;
  const bodySpec = typeof spec.body === "function" ? spec.body(deps) : spec.body;
  const read = await readDecoded({ request: exchange.request, context: exchange.context, diagnostics: deps.dispatch }, bodySpec);
  if (read.kind === "refused") { exchange.request.resume(); respondRefusal(deps, exchange, read.refusal); return; }
  write(deps, exchange, await spec.handle({ ...exchange, deps, body: read.body, bytes: read.bytes, param }));
}

function identityOf(spec: { method: RouteMethod; path: string }, open: boolean): { method: RouteMethod; path: string; open: boolean } {
  return { method: spec.method, path: spec.path, open };
}

/** Declares and mounts a route that reads no body; the path may hold one `:param` segment. */
export function route<Answer>(spec: BodylessRoute<Answer>): MountedRoute {
  return mount(identityOf(spec, spec.open === true), (deps, exchange, param) => serveBodyless(spec, deps, exchange, param));
}

/** Declares and mounts a route whose body is decoded before its handler runs. */
export function bodyRoute<Body, Answer>(spec: BodyRoute<Body, Answer>): MountedRoute {
  return mount(identityOf(spec, false), (deps, exchange, param) => serveWithBody(spec, deps, exchange, param));
}

/** Finds the first mounted route that answers the method and path, with its `:param` value. */
export function findRoute(routes: readonly MountedRoute[], method: string, pathname: string): { route: MountedRoute; param: string } | undefined {
  for (const candidate of routes) {
    const param = candidate.param(method, pathname);
    if (param !== null) return { route: candidate, param };
  }
  return undefined;
}
