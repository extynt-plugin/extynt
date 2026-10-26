/** The sidecar's HTTP surface: profiles and host census, pairing and authenticated ingest, and the snapshot boundary. */
import type { JsonValue } from "@extynt/decode";
import { errorCodeOf, fieldOf, flagOf, maybeTextOf, numberOf, readJson, recordOf, textOf } from "./http-json.js";
import { createDiagnosticSink, type DiagnosticEvent } from "../src/diagnostics.js";
import { loadHostProfile, saveHostProfile, scanPresetInventory } from "../src/profile-store.js";
import { rawRequest } from "./raw-request.js";
import { authorization, claimResponse, hostCensus, mutableSnapshot, sidecarFor, token, validSnapshot } from "./sidecar-fixture.js";
import { fontsAreAuthoritative, makeFontInventory, makeHostProfile, makeInventory } from "@extynt/capability-catalogue";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("profile store survives restart, rejects corrupt/future/host-mismatched cache, and redacts preset paths", () => {
  const root = mkdtempSync(join(tmpdir(), "ae-profile-"));
  const hostProfile = makeHostProfile(makeInventory({ application: "After Effects", version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" }, []));
  saveHostProfile(hostProfile, root);
  assert.equal(loadHostProfile(root, hostProfile.host)?.profileId, hostProfile.profileId);
  assert.equal(loadHostProfile(root, { ...hostProfile.host, buildNumber: "3" }), undefined);
  writeFileSync(join(root, "host-capability-profile.json"), "{");
  assert.equal(loadHostProfile(root), undefined);
  const presets = join(root, "Presets"); mkdirSync(join(presets, "Category"), { recursive: true });
  for (let index = 0; index < 621; index += 1) writeFileSync(join(presets, "Category", `preset-${index}.ffx`), "x");
  mkdirSync(join(presets, "(ignored)")); writeFileSync(join(presets, "(ignored)", "hidden.ffx"), "x");
  const inventory = scanPresetInventory([{ path: presets, alias: "user-presets" }], 700);
  assert.equal(inventory.items.length, 621);
  assert.equal(inventory.truncated, false);
  assert.equal(JSON.stringify(inventory).includes(root), false);
  const complete = makeHostProfile(makeInventory(hostProfile.host, []), undefined, inventory);
  saveHostProfile({ ...complete, entries: complete.entries.filter((entry) => entry.kind !== "preset") }, root);
  const migrated = loadHostProfile(root, complete.host);
  assert.ok(migrated);
  assert.equal(migrated.entries.filter((entry) => entry.kind === "preset").length, 621);
});

test("a profile from before the font census loads as an empty census, never a default font", () => {
  const root = mkdtempSync(join(tmpdir(), "ae-font-profile-"));
  const hostProfile = makeHostProfile(makeInventory({ application: "After Effects", version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" }, []));

  const { fontInventory: _dropped, ...legacy } = hostProfile;
  writeFileSync(join(root, "host-capability-profile.json"), JSON.stringify(legacy));
  const loaded = loadHostProfile(root);
  assert.ok(loaded);
  assert.deepEqual(loaded.fontInventory.items, []);
  assert.equal(loaded.fontInventory.completeness, "failed");
  assert.equal(fontsAreAuthoritative(loaded.fontInventory), false);
  assert.equal(JSON.stringify(loaded.fontInventory).includes("Helvetica"), false);

  saveHostProfile({ ...hostProfile, fontInventory: makeFontInventory([{ family: "Helvetica", style: "Bold", postScriptName: "Helvetica-Bold" }]) }, root);
  assert.deepEqual(loadHostProfile(root)?.fontInventory.items.map((font) => font.postScriptName), ["Helvetica-Bold"]);
});

test("a census's installed fonts reach the profile identity, and a malformed list is refused", async (t) => {

  const stateDirectory = mkdtempSync(join(tmpdir(), "ae-font-census-"));
  const sidecar = sidecarFor({ port: 0, token, maxBodyBytes: 400_000, stateDirectory }); const address = await sidecar.start(); t.after(() => sidecar.stop());
  const url = `http://${address.host}:${address.port}/v1/host-census`;
  const censusWithFonts = (fonts: JsonValue) => ({ ...hostCensus(2), result: { ...hostCensus(2).result, installedFonts: fonts, fontTotalReported: Array.isArray(fonts) ? fonts.length : 0, fontFamiliesReported: Array.isArray(fonts) ? fonts.length : 0, fontCompleteness: "complete" } });
  const post = async <Payload>(body: Payload) => { const response = await fetch(url, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: response.status, body: recordOf(await readJson(response), "") }; };
  const helvetica = await post(censusWithFonts([{ family: "Helvetica", style: "Bold", postScriptName: "Helvetica-Bold" }]));
  assert.equal(helvetica.status, 201);
  const inter = await post(censusWithFonts([{ family: "Inter", style: "Bold", postScriptName: "Inter-Bold" }]));
  assert.equal(inter.status, 201);
  assert.notEqual(inter.body.profileId, helvetica.body.profileId, "a host with different fonts is a different profile, so a cache can never answer for the wrong font list");
  const again = await post(censusWithFonts([{ family: "Helvetica", style: "Bold", postScriptName: "Helvetica-Bold" }]));
  assert.equal(again.body.profileId, helvetica.body.profileId, "the same census must be the same profile");

  const malformed = await post({ ...hostCensus(2), result: { ...hostCensus(2).result, installedFonts: "Helvetica" } });
  assert.equal(malformed.status, 422);

  assert.equal((await post(hostCensus(2))).status, 201);

  assert.ok(existsSync(join(stateDirectory, "host-capability-profile.json")), "the census profile is stored under the sidecar's state directory");
});

test("the pairing route lets a co-located caller learn the port and token without a bearer header", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, now: () => new Date("2026-09-11T12:00:00.000Z") });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const pair = await fetch(`http://${address.host}:${address.port}/v1/pair`);
  assert.equal(pair.status, 200);
  const body = await readJson(pair);
  assert.equal(flagOf(body, "ok"), true);
  assert.equal(numberOf(body, "port"), address.port);

  assert.equal(maybeTextOf(body, "token"), undefined);
  assert.equal(flagOf(body, "paired"), false);
  const authenticated = await fetch(`http://${address.host}:${address.port}/v1/pair`, { headers: authorization });
  assert.equal(flagOf(await readJson(authenticated), "paired"), true);
});

test("a newly paired panel instance cannot reuse a prior snapshot, plan, or mailbox command", async (t) => {
  const sidecar = sidecarFor({ port: 0, token });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const endpoint = `http://${address.host}:${address.port}`;
  const pair = async (instance: string) => fetch(`${endpoint}/v1/pair`, { headers: { ...authorization, "X-AE-Panel-Instance": instance } });

  const anonymous = await fetch(`${endpoint}/v1/pair`, { headers: { "X-AE-Panel-Instance": "panel-intruder" } });
  assert.equal(flagOf(await readJson(anonymous), "paired"), false);
  const postSnapshot = async (instance: string, requestId: string) => fetch(`${endpoint}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "X-AE-Panel-Instance": instance }, body: JSON.stringify({ ...mutableSnapshot(requestId), requestId }) });

  assert.equal((await pair("panel-a")).status, 200);
  assert.equal((await postSnapshot("panel-a", "epoch-a")).status, 201);
  const tool = await fetch(`${endpoint}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: "ae_list_plans" }) });
  assert.equal(tool.status, 200);

  assert.equal((await pair("panel-b")).status, 200);
  assert.equal((await fetch(`${endpoint}/v1/snapshots/latest`, { headers: authorization })).status, 404);
  const staleSnapshot = await postSnapshot("panel-a", "epoch-a-stale");
  assert.equal(staleSnapshot.status, 409);
  assert.equal(textOf(await readJson(staleSnapshot), "error.code"), "STALE_PANEL_INSTANCE");
  const blockedClaim = claimResponse(sidecar);
  assert.equal(blockedClaim.status, 409);
  assert.equal(textOf(await readJson(blockedClaim), "error.code"), "AWAITING_FRESH_SNAPSHOT");
  const blockedPlan = await fetch(`${endpoint}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: "ae_list_plans" }) });
  assert.equal(blockedPlan.status, 409);
  assert.equal(textOf(await readJson(blockedPlan), "error.code"), "AWAITING_FRESH_SNAPSHOT");
  assert.equal((await postSnapshot("panel-b", "epoch-b")).status, 201);
  assert.equal(claimResponse(sidecar).status, 200);
});

test("authenticated startup host census creates a profile before any project snapshot", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, maxBodyBytes: 100_000 }); const address = await sidecar.start(); t.after(() => sidecar.stop());
  const url = `http://${address.host}:${address.port}/v1/host-census`;
  assert.equal((await fetch(url, { method: "POST", body: JSON.stringify(hostCensus()) })).status, 401);
  assert.equal((await fetch(url, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: "{}" })).status, 422);
  const accepted = await fetch(url, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(hostCensus()) });
  assert.equal(accepted.status, 201);
  const profile = await fetch(`http://${address.host}:${address.port}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: "ae_get_host_profile_summary" }) });
  assert.equal(profile.status, 200);
  const data = await readJson(profile); assert.equal(numberOf(data, "data.effects.total"), 400);
});

test("host census endpoint enforces its body bound", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, maxBodyBytes: 1024 }); const address = await sidecar.start(); t.after(() => sidecar.stop());
  const response = await fetch(`http://${address.host}:${address.port}/v1/host-census`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: "x".repeat(2000) });
  assert.equal(response.status, 413);
});

test("health and latest are loopback read endpoints", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, now: () => new Date("2026-09-11T12:00:00.000Z") });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const health = await fetch(`http://${address.host}:${address.port}/health`, { headers: authorization });
  assert.equal(health.status, 200);
  const healthBody = await readJson(health);
  assert.equal(flagOf(healthBody, "hasSnapshot"), false);
  assert.deepEqual(recordOf(healthBody, "diagnostics"), { preflightCount: 0, snapshotPostCount: 0 });
  const latest = await fetch(`http://${address.host}:${address.port}/v1/snapshots/latest`, { headers: authorization });
  assert.equal(latest.status, 404);
});

test("development diagnostics cover health and receive phases without sensitive fields", async (t) => {
  const events: DiagnosticEvent[] = [];
  const sidecar = sidecarFor({ port: 0, token, diagnostics: { enabled: true, environment: "development", logger: (event) => events.push(event) } });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const correlationId = "corr-test-1";
  const headers = { ...authorization, "X-AE-Correlation-Id": correlationId, "X-AE-Request-Id": "panel-test-1" };
  const health = await fetch(`http://${address.host}:${address.port}/health`, { headers });
  assert.equal(health.headers.get("x-ae-correlation-id"), correlationId);
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(validSnapshot) });

  assert.ok(events.some((event) => event.phase === "health" && event.event === "phase.completed" && event.outcome === "succeeded"));
  assert.ok(events.some((event) => event.phase === "snapshot.body" && event.event === "phase.completed" && event.bytes));
  assert.ok(events.some((event) => event.phase === "snapshot.validate" && event.outcome === "succeeded"));
  assert.ok(events.some((event) => event.event === "request.completed" && event.requestId === "probe-1" && event.correlationId === correlationId));
  assert.ok(events.every((event) => event.timestamp && (event.durationMs === undefined || event.durationMs >= 0)));
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes("Fixture"), false);
  assert.equal(serialized.includes("layer-1"), false);
});

test("production diagnostics remain disabled even when explicitly enabled", () => {
  const events: DiagnosticEvent[] = [];
  const sink = createDiagnosticSink({ enabled: true, environment: "production", logger: (event) => events.push(event) });
  assert.equal(sink.enabled, false);
  sink.emit({ level: "debug", event: "request.started", phase: "request", correlationId: "corr-1", requestId: null, method: "GET", route: "/health", outcome: "started" });
  assert.deepEqual(events, []);
});

test("accepts a CEP snapshot and serves the latest snapshot", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, now: () => new Date("2026-09-11T12:00:00.000Z") });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const accepted = await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(validSnapshot) });
  assert.equal(accepted.status, 201);
  const acknowledgement = await readJson(accepted);
  assert.equal(flagOf(acknowledgement, "accepted"), true);
  const latest = await fetch(`http://${address.host}:${address.port}/v1/snapshots/latest`, { headers: authorization });
  const body = recordOf(await readJson(latest), "");
  assert.equal(latest.status, 200);
  assert.equal(textOf(body, "receivedAt"), "2026-09-11T12:00:00.000Z");
  assert.equal(textOf(body, "snapshot.result.project.name"), "Fixture");
});

test("rejects malformed snapshots and mutation-looking endpoints", async (t) => {
  const sidecar = sidecarFor({ port: 0, token });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const invalid = await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: authorization, body: "{}" });
  assert.equal(invalid.status, 422);
  const mutation = await fetch(`http://${address.host}:${address.port}/execute`, { method: "POST", headers: authorization, body: "{}" });
  assert.equal(mutation.status, 405);
  assert.equal(textOf(await readJson(mutation), "error.code"), "READ_ONLY");
});

test("enforces the bounded request body", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, maxBodyBytes: 1024 });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const oversized = await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: authorization, body: "x".repeat(2000) });
  assert.equal(oversized.status, 413);
  assert.equal(textOf(await readJson(oversized), "error.code"), "BODY_LIMIT");
});

test("requires authentication, and a browser preflight from another origin is refused with no CORS approval", async (t) => {
  const sidecar = sidecarFor({ port: 0, token });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const unauthorized = await fetch(`http://${address.host}:${address.port}/health`);
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("access-control-allow-origin"), null);
  const preflight = await fetch(`http://${address.host}:${address.port}/v1/snapshots`, {
    method: "OPTIONS",
    headers: { Origin: "https://example.test", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type", "Access-Control-Request-Private-Network": "true" },
  });
  assert.equal(preflight.status, 403);
  for (const name of ["access-control-allow-origin", "access-control-allow-headers", "access-control-allow-methods", "access-control-allow-private-network"]) assert.equal(preflight.headers.get(name), null, name);
  const health = await fetch(`http://${address.host}:${address.port}/health`, { headers: authorization });
  assert.equal(health.headers.get("access-control-allow-origin"), null);
  const diagnostics = recordOf(await readJson(health), "diagnostics");
  assert.deepEqual(diagnostics, { preflightCount: 1, snapshotPostCount: 0 });
});

test("every route refuses a Host header that is not the sidecar's own loopback name and port", async (t) => {
  const sidecar = sidecarFor({ port: 0, token });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  for (const [method, path] of [["GET", "/health"], ["GET", "/v1/pair"], ["POST", "/v1/snapshots"], ["GET", "/v1/workflow/status"], ["OPTIONS", "/health"]] as const) {
    const answer = await rawRequest(address.port, { method, path, headers: { host: "rebind.example.test", authorization: `Bearer ${token}` } });
    assert.equal(answer.status, 403, `${method} ${path}`);
    assert.match(answer.body, /FORBIDDEN_HOST/);
  }
  const wrongPort = await rawRequest(address.port, { method: "GET", path: "/health", headers: { host: `127.0.0.1:${address.port + 1}`, authorization: `Bearer ${token}` } });
  assert.equal(wrongPort.status, 403);
  const own = await rawRequest(address.port, { method: "GET", path: "/health", headers: { host: `localhost:${address.port}`, authorization: `Bearer ${token}` } });
  assert.equal(own.status, 200);
});

const postJson = <Payload>(base: string, path: string, body: Payload, options: { headers?: Record<string, string>; timeoutMs?: number } = {}) =>
  fetch(`${base}${path}`, { method: "POST", headers: { ...authorization, "content-type": "application/json", ...options.headers }, body: JSON.stringify(body), ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}) });

const withRevision = (snapshot: ReturnType<typeof mutableSnapshot>, revision: string) => ({ ...snapshot, result: { ...snapshot.result, revision } });

test("a malformed snapshot composition is refused instead of exiting the sidecar or replacing the stored snapshot", async (t) => {
  const sidecar = sidecarFor({ port: 0, token });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const good = mutableSnapshot("probe-good");
  assert.equal((await postJson(base, "/v1/snapshots", good)).status, 201);

  const hostile: JsonValue[][] = [[{}], [null], [{ layers: "nope" }], [{ layers: [null] }], [{ layers: [{ propertyPaths: 5 }] }], [{ layers: [{ propertyPaths: [null] }] }]];
  for (const compositions of hostile) {
    const response = await postJson(base, "/v1/snapshots", { ...good, requestId: "probe-hostile", result: { ...good.result, compositions } }, { timeoutMs: 2_000 });
    assert.equal(response.status, 422, `compositions ${JSON.stringify(compositions)} must be refused`);
    assert.equal(textOf(await readJson(response), "error.code"), "INVALID_SNAPSHOT");
  }
  const latest = await readJson((await fetch(`${base}/v1/snapshots/latest`, { headers: authorization })));
  assert.equal(textOf(latest, "snapshot.requestId"), "probe-good", "a refused snapshot never becomes the current project state");
  assert.equal((await fetch(`${base}/health`, { headers: authorization })).status, 200, "the sidecar is still serving");
});

test("a handler throw answers the caller with a 500 and the sidecar keeps serving", async (t) => {
  const sidecar = sidecarFor({ port: 0, token });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;

  Object.assign(sidecar, { markPanelSeen: () => { throw new Error("synthetic handler failure"); } });
  const failed = await postJson(base, "/v1/snapshots", mutableSnapshot("probe-throw"), { timeoutMs: 2_000 });
  assert.equal(failed.status, 500);
  assert.equal(textOf(await readJson(failed), "error.code"), "INTERNAL_ERROR");
  assert.equal((await fetch(`${base}/health`, { headers: authorization })).status, 200, "one failed request must not take the process down");
});

test("a replayed older snapshot cannot overwrite the newer observation", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, panelSessionId: "panel-regression" });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const tool = async (name: string, args: Record<string, JsonValue>) => recordOf(await readJson((await postJson(base, "/v1/mcp/tools/call", { name, arguments: args }))), "");
  const older = withRevision(mutableSnapshot("probe-A", ["layer-1"], "Original"), "rev-A");
  const newer = withRevision(mutableSnapshot("probe-B", ["layer-1"], "Renamed by the user"), "rev-B");
  assert.equal((await postJson(base, "/v1/snapshots", older)).status, 201);
  const planId = String(fieldOf(await tool("ae_prepare_change", {}), "data.planId"));
  assert.equal((await postJson(base, "/v1/snapshots", newer)).status, 201);
  const refused = await tool("ae_approve_plan", { planId, waitSeconds: 0, acknowledgeUnverified: true });
  assert.equal(refused.ok, false, "a plan bound to the superseded state is stale while the newer observation is current");
  assert.equal(errorCodeOf(refused), "STALE_SNAPSHOT");

  const replay = await postJson(base, "/v1/snapshots", older);
  assert.equal(replay.status, 409);
  assert.equal(textOf(await readJson(replay), "error.code"), "SUPERSEDED_SNAPSHOT");
  const latest = await readJson((await fetch(`${base}/v1/snapshots/latest`, { headers: authorization })));
  assert.equal(textOf(latest, "snapshot.requestId"), "probe-B");
  const stillStale = await tool("ae_approve_plan", { planId, waitSeconds: 0, acknowledgeUnverified: true });
  assert.equal(errorCodeOf(stillStale), "STALE_SNAPSHOT");

  assert.equal((await postJson(base, "/v1/snapshots", withRevision(mutableSnapshot("probe-B2", ["layer-1"], "Renamed by the user"), "rev-B"))).status, 201);
});
