// The live probe: no key, a rejected key and an unreachable server each give their own skip reason, and a working key gives none.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { KEY_MISSING_REASON, KEY_REJECTED_REASON, NETWORK_DOWN_REASON, liveSkipReason } from "../src/index.js";

async function serving(status: number): Promise<{ readonly url: string; close(): void }> {
  const server = createServer((_request, response) => { response.statusCode = status; response.end("{}"); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

test("no key skips with the missing-key reason", async () => {
  assert.equal(await liveSkipReason(""), KEY_MISSING_REASON);
});

test("a 401 and a 403 skip with the rejected-key reason", async () => {
  for (const status of [401, 403]) {
    const server = await serving(status);
    assert.equal(await liveSkipReason(`key-${status}`, server.url), KEY_REJECTED_REASON);
    server.close();
  }
});

test("a working key does not skip, and the answer is cached per key", async () => {
  const server = await serving(200);
  assert.equal(await liveSkipReason("good", server.url), false);
  server.close();
  assert.equal(await liveSkipReason("good", server.url), false);
});

test("an unreachable server skips with its own reason", async () => {
  assert.equal(await liveSkipReason("offline", "http://127.0.0.1:1"), NETWORK_DOWN_REASON);
});
