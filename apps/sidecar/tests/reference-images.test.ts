/** Reference images on a brief: /v1/chat validation, the files they are kept in, the owner's first step, and the text-only fallback. */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { MockProvider } from "@extynt/llm";
import { maybeTextOf, readJson } from "./http-json.js";
import type { JsonValue } from "./http-json.js";
import { authorization, mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";
import { present } from "./present.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/";
const WEBP = "UklGRhwAAABXRUJQVlA4TBAAAAAvAAAAAAfQ//73v/+BiOh/AAA=";

async function rig(t: test.TestContext, provider = new MockProvider({ answer: "Seen." })) {
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("refs")) });
  const post = (images: JsonValue | undefined, message = "make it look like this") => fetch(`http://${address.host}:${address.port}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId: `refs-${Math.random().toString(16).slice(2)}`, message, images }) });
  return { sidecar, provider, post, directory: present(sidecar.options.stateDirectory) };
}

test("bad reference images are refused with a plain reason before any model is called", async (t) => {
  const { provider, post } = await rig(t);
  const big = "iVBOR" + "A".repeat(7_000_000);
  const cases: Array<[JsonValue, RegExp]> = [
    ["nope", /must be a list/],
    [Array.from({ length: 7 }, () => ({ mediaType: "image/png", base64: PNG })), /At most 6/],
    [[{ mediaType: "image/gif", base64: PNG }], /PNG, JPEG or WebP/],
    [[{ mediaType: "image/png", base64: "not base64!" }], /not valid base64/],
    [[{ mediaType: "image/png", base64: JPEG }], /not the PNG it says it is/],
    [[{ mediaType: "image/png", base64: big }], /limit is 5 MB each/],
  ];
  for (const [images, message] of cases) {
    const response = await post(images);
    assert.equal(response.status, 422, message.source);
    const body = await readJson(response);
    assert.equal(maybeTextOf(body, "error.code"), "INVALID_REFERENCE_IMAGES");
    assert.match(maybeTextOf(body, "error.message") ?? "", message);
  }
  assert.equal(provider.stepInputs.length, 0);
});

test("PNG, JPEG and WebP references reach the owner's first step and are kept as private files", async (t) => {
  const { provider, post, directory } = await rig(t, new MockProvider({ answer: "Seen.", acceptsImages: true }));
  const response = await post([{ mediaType: "image/png", base64: PNG, name: "../mood board.png" }, { mediaType: "image/jpeg", base64: JPEG }, { mediaType: "image/webp", base64: WEBP }]);
  assert.equal(response.status, 200);
  assert.deepEqual(present(provider.stepInputs[0]).images, [{ mediaType: "image/png", base64: PNG }, { mediaType: "image/jpeg", base64: JPEG }, { mediaType: "image/webp", base64: WEBP }]);
  assert.doesNotMatch(String(present(provider.stepInputs[0]).messages.at(-1)?.content), /cannot see them/);
  const root = join(directory, "references");
  const [job] = readdirSync(root);
  const files = readdirSync(join(root, present(job)));
  assert.deepEqual(files, ["1-mood_board.png", "2-image.jpg", "3-image.webp"], "the name is made safe and the order kept");
  assert.equal(statSync(join(root, present(job))).mode & 0o777, 0o700);
  assert.ok(files.every((file) => (statSync(join(root, present(job), file)).mode & 0o777) === 0o600));
  assert.equal(readFileSync(join(root, present(job), present(files[0]))).toString("base64"), PNG);
});

test("a model that cannot see images is told so in one plain line, and is sent no pictures", async (t) => {
  const { provider, post } = await rig(t, new MockProvider({ answer: "Ok.", acceptsImages: false }));
  await post([{ mediaType: "image/png", base64: PNG }, { mediaType: "image/png", base64: PNG }]);
  const first = String(present(provider.stepInputs[0]).messages.find((message) => message.role === "user")?.content);
  assert.match(first, /2 reference images were attached to this request, but this model cannot see them\./);
  assert.ok(provider.stepInputs.every((input) => !input.images?.length));
});

test("a chat with no images is unchanged", async (t) => {
  const { provider, post, directory } = await rig(t);
  await post(undefined);
  assert.equal(present(provider.stepInputs[0]).images, undefined);
  assert.throws(() => readdirSync(join(directory, "references")));
});

test("job ids of '.' and '..' never resolve outside references/, and nothing is deleted", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { setReferences, referencesOf } = await import("../src/workflow-references.js");
  const state = mkdtempSync(join(tmpdir(), "ae-refs-"));
  mkdirSync(join(state, "references", "old-job"), { recursive: true });
  writeFileSync(join(state, "keep.txt"), "x"); writeFileSync(join(state, "references", "keep.txt"), "x");
  const host = { options: { stateDirectory: state }, workflowCoordinator: { workflowStore: { getState: () => ({ jobs: {} }) } } };
  for (const id of [".", "..", "...", ""]) {
    setReferences(host, id, [{ mediaType: "image/png", base64: PNG }]);
    assert.deepEqual(referencesOf(host, id), []);
  }
  assert.ok(existsSync(join(state, "keep.txt")) && existsSync(join(state, "references", "keep.txt")) && existsSync(join(state, "references", "old-job")), "nothing was deleted");
  assert.deepEqual(readdirSync(state).sort(), ["keep.txt", "references"]);
});
