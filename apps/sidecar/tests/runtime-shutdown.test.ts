// Tests the shutdown route: the host-closing signal is acknowledged, the process ends once the stop settles, and the request is authorised.
import assert from "node:assert/strict";
import test from "node:test";

import { authorization, sidecarFor, token } from "./sidecar-fixture.js";
import { flagOf, readJson, textOf } from "./http-json.js";
import type { JsonValue } from "./http-json.js";

const instanceHeader = { "X-AE-Panel-Instance": "panel-shutdown" };
const shutdownBody = { schemaVersion: "0.1", reason: "cep-host-closing" };

async function pair(base: string): Promise<Response> {
  return fetch(`${base}/v1/pair`, { headers: { ...authorization, ...instanceHeader } });
}

async function shutdown(base: string, body: JsonValue = shutdownBody, headers: Record<string, string> = instanceHeader): Promise<Response> {
  return fetch(`${base}/v1/panel/shutdown`, { method: "POST", headers: { ...authorization, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

test("the paired CEP host-closing signal is acknowledged before graceful shutdown", async () => {
  const sidecar = sidecarFor({ port: 0, token });
  const address = await sidecar.start();
  const base = `http://${address.host}:${address.port}`;
  assert.equal((await pair(base)).status, 200);
  const controller = new AbortController();
  sidecar.activeChatTurn = { requestId: "active-at-quit", controller, startedAt: Date.now(), settled: Promise.resolve() };

  const response = await shutdown(base);
  assert.equal(response.status, 202);
  const acknowledgement = await readJson(response);
  assert.equal(flagOf(acknowledgement, "ok"), true);
  assert.equal(flagOf(acknowledgement, "shuttingDown"), true);
  assert.deepEqual(sidecar.shutdownRequested, { panelInstanceId: "panel-shutdown", requestedAt: sidecar.shutdownRequested?.requestedAt, reason: "cep-host-closing" });

  for (let attempt = 0; attempt < 80 && sidecar.server !== undefined; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(sidecar.server, undefined, "shutdown starts only after the acknowledgement finishes");
  assert.equal(controller.signal.aborted, true, "the ordinary stop path aborts an active turn");
  assert.equal(sidecar.approvalSweep, undefined, "the lifecycle timer is released");
  await sidecar.stop();
});

test("after the host-closing stop settles, the composition root is told to end the process", async () => {
  let closed = 0;
  const sidecar = sidecarFor({ port: 0, token, onHostClosed: () => { closed += 1; } });
  const address = await sidecar.start();
  const base = `http://${address.host}:${address.port}`;
  assert.equal((await pair(base)).status, 200);
  assert.equal((await shutdown(base)).status, 202);
  for (let attempt = 0; attempt < 80 && closed === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(closed, 1, "a stopped server alone would leave a portless process that launchd never restarts");
  assert.equal(sidecar.server, undefined);
});

test("shutdown requires auth, the active panel instance, and the exact host-closing contract", async (t) => {
  const sidecar = sidecarFor({ port: 0, token });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  assert.equal((await pair(base)).status, 200);

  const unauthorized = await fetch(`${base}/v1/panel/shutdown`, { method: "POST", headers: { "content-type": "application/json", ...instanceHeader }, body: JSON.stringify(shutdownBody) });
  assert.equal(unauthorized.status, 401);
  assert.equal(textOf(await readJson(unauthorized), "error.code"), "UNAUTHORIZED");
  const missing = await shutdown(base, shutdownBody, {});
  assert.equal(missing.status, 409);
  assert.equal(textOf(await readJson(missing), "error.code"), "PANEL_INSTANCE_REQUIRED");
  const stale = await shutdown(base, shutdownBody, { "X-AE-Panel-Instance": "panel-stale" });
  assert.equal(stale.status, 409);
  assert.equal(textOf(await readJson(stale), "error.code"), "STALE_PANEL_INSTANCE");
  const malformed = await shutdown(base, { schemaVersion: "0.1", reason: "panel-unload" });
  assert.equal(malformed.status, 422);
  assert.equal(textOf(await readJson(malformed), "error.code"), "INVALID_SHUTDOWN_SIGNAL");

  sidecar.panel.lastSeenAt = 0;
  sidecar.failUnclaimedApprovals();
  assert.equal(sidecar.shutdownRequested, null, "lease expiry and ordinary disconnect handling never request process shutdown");
  assert.equal((await fetch(`${base}/health`, { headers: authorization })).status, 200);

  sidecar.shutdownRequested = { panelInstanceId: "panel-shutdown", requestedAt: "2026-09-22T12:00:00.000Z", reason: "cep-host-closing" };
  const duplicate = await shutdown(base);
  assert.equal(duplicate.status, 202);
  assert.deepEqual(await readJson(duplicate), { ok: true, shuttingDown: true }, "duplicate one-shot delivery is idempotent");
  assert.equal((await fetch(`${base}/health`, { headers: authorization })).status, 200, "the duplicate does not create a second shutdown lifecycle");
});
