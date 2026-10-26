// Unauthenticated static serving of the panel UI under /ui/, from a fixed whitelist of files; no token, no secrets.
import type { IncomingMessage, ServerResponse } from "node:http";
import { lstatSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { errorEnvelope } from "./server-http-wire.js";
import type { RequestContext } from "./server-types.js";

export const UI_CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'";
const MAX_STATIC_BYTES = 4 * 1024 * 1024;
const WHITELIST = /^(?:index\.html|main\.js|ui-manifest\.json|styles\/[a-z0-9-]+\.css|styles\/components\/[a-z0-9-]+\.css|fonts\/[A-Za-z0-9_-]+\.(?:woff2|woff|ttf|otf))$/;
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
};
type StaticDeps = Pick<HttpRoutesDeps, "dispatch"> & { state: Pick<HttpRoutesDeps["state"], "options" | "port"> };

export function isUiStaticPath(pathname: string): boolean { return pathname === "/ui" || pathname.startsWith("/ui/"); }

/** Dev default: the repository's apps/panel, relative to dist/src/ of this package. */
export function uiDirectoryOf(state: Pick<HttpRoutesDeps["state"], "options">): string {
  return state.options.uiDirectory ?? join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "panel");
}

/** DNS-rebinding defence: the page and its API are reachable only under the exact loopback origins. */
export function hostAllowed(state: Pick<HttpRoutesDeps["state"], "port">, request: IncomingMessage): boolean {
  const host = request.headers.host;
  return state.port !== undefined && (host === `127.0.0.1:${state.port}` || host === `localhost:${state.port}`);
}

export function refuseHost(deps: Pick<HttpRoutesDeps, "dispatch">, response: ServerResponse, context: RequestContext): void {
  deps.dispatch.respond({ response, context, statusCode: 403, value: errorEnvelope("FORBIDDEN_HOST", "The Host header must be 127.0.0.1 or localhost with the sidecar's port."), outcome: "rejected", errorCode: "FORBIDDEN_HOST" });
}

function galleryServed(deps: StaticDeps): boolean {
  return deps.state.options.uiDirectory === undefined && process.env.EXTYNT_UI_GALLERY === "1";
}

function plainPath(request: IncomingMessage, pathname: string): boolean {
  const raw = (request.url ?? "").split(/[?#]/, 1)[0] ?? "";
  return raw === pathname && !raw.includes("%") && !raw.includes("\\");
}

function staticName(deps: StaticDeps, request: IncomingMessage, pathname: string): string | undefined {
  if (!plainPath(request, pathname)) return undefined;
  const name = pathname === "/ui/" ? "index.html" : pathname.slice("/ui/".length);
  if (name === "gallery.html" || name === "gallery-icons.js") return galleryServed(deps) ? name : undefined;
  return WHITELIST.test(name) ? name : undefined;
}

function regularFileIn(root: string, name: string): string | undefined {
  try {
    const file = join(root, name), stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STATIC_BYTES) return undefined;
    return realpathSync(file).startsWith(realpathSync(root) + sep) ? file : undefined;
  } catch { return undefined; }
}

function staticHeaders(response: ServerResponse, contentType: string, bytes: number): void {
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", bytes);
  response.setHeader("Content-Security-Policy", UI_CONTENT_SECURITY_POLICY);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function notFound(deps: StaticDeps, response: ServerResponse, context: RequestContext): void {
  deps.dispatch.respond({ response, context, statusCode: 404, value: errorEnvelope("NOT_FOUND", "No such UI file."), outcome: "rejected", errorCode: "NOT_FOUND" });
}

async function sendFile(deps: StaticDeps, input: { response: ServerResponse; context: RequestContext; file: string; head: boolean }): Promise<void> {
  const { response, context, file, head } = input;
  const body = await readFile(file);
  staticHeaders(response, CONTENT_TYPES[extname(file)] ?? "application/octet-stream", body.byteLength);
  response.statusCode = 200;
  response.end(head ? undefined : body);
  deps.dispatch.emit(context, "response", "request.completed", { outcome: "succeeded", statusCode: 200, bytes: body.byteLength });
}

/** GET and HEAD of whitelisted UI files; everything else is refused or 404, never an error that names a path. */
export async function serveUiStatic(deps: StaticDeps, request: IncomingMessage, response: ServerResponse, context: RequestContext): Promise<void> {
  request.resume();
  if (!hostAllowed(deps.state, request)) { refuseHost(deps, response, context); return; }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    deps.dispatch.respond({ response, context, statusCode: 405, value: errorEnvelope("METHOD_NOT_ALLOWED", "UI files are read with GET or HEAD."), outcome: "rejected", errorCode: "METHOD_NOT_ALLOWED" });
    return;
  }
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/ui") {
    response.setHeader("Location", "/ui/");
    response.setHeader("Cache-Control", "no-cache");
    response.statusCode = 308;
    response.end();
    deps.dispatch.emit(context, "response", "request.completed", { outcome: "succeeded", statusCode: 308 });
    return;
  }
  const name = staticName(deps, request, pathname), file = name === undefined ? undefined : regularFileIn(uiDirectoryOf(deps.state), name);
  if (file === undefined) { notFound(deps, response, context); return; }
  await sendFile(deps, { response, context, file, head: request.method === "HEAD" });
}
