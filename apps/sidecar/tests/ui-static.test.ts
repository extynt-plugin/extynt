/** The sidecar serves the panel UI: whitelisted files only, no token, exact security headers, the Host check, and no path out of the directory. */
import assert from "node:assert/strict";
import { existsSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { sidecarFor, token } from "./sidecar-fixture.js";
import { uiDirectoryOf, UI_CONTENT_SECURITY_POLICY } from "../src/server-ui-static.js";
import { raw, startUiSidecar } from "./ui-fixture.js";

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'";

test("whitelisted files are served without a token, with the exact security headers and no CORS", async (t) => {
  const { port } = await startUiSidecar(t);
  assert.equal(UI_CONTENT_SECURITY_POLICY, CSP);
  const expected: Array<[string, string, string]> = [
    ["/ui/", "text/html; charset=utf-8", "<title>extynt</title>"], ["/ui/index.html", "text/html; charset=utf-8", "<title>extynt</title>"],
    ["/ui/main.js", "text/javascript; charset=utf-8", "console.log(1);"],
    ["/ui/ui-manifest.json", "application/json", "files"], ["/ui/styles/app.css", "text/css; charset=utf-8", "body{}"],
    ["/ui/styles/components/button.css", "text/css; charset=utf-8", ".b{}"], ["/ui/fonts/inter.woff2", "font/woff2", "font-bytes"],
  ];
  for (const [path, type, snippet] of expected) {
    const response = await raw(port, { path });
    assert.equal(response.status, 200, path);
    assert.equal(response.headers["content-type"], type, path);
    assert.ok(response.text.includes(snippet), path);
    assert.equal(response.headers["content-security-policy"], CSP);
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["cache-control"], "no-cache");
    assert.equal(response.headers["referrer-policy"], "no-referrer");
    assert.equal(response.headers["access-control-allow-origin"], undefined);
    assert.equal(response.headers["access-control-allow-headers"], undefined);
  }
  const head = await raw(port, { method: "HEAD", path: "/ui/main.js" });
  assert.equal(head.status, 200);
  assert.equal(head.text, "");
  assert.ok(Number(head.headers["content-length"]) > 0);
});

test("the Host header must be the loopback origin with the sidecar's port", async (t) => {
  const { port } = await startUiSidecar(t);
  for (const host of [`evil.example:${port}`, "127.0.0.1", `127.0.0.1:${port + 1}`, `LOCALHOST.evil:${port}`]) {
    const page = await raw(port, { path: "/ui/", headers: { Host: host } });
    assert.equal(page.status, 403, host);
    assert.match(page.text, /FORBIDDEN_HOST/);
    const api = await raw(port, { path: "/v1/ui/bootstrap", headers: { Host: host }, authorized: true });
    assert.equal(api.status, 403, host);
    assert.match(api.text, /FORBIDDEN_HOST/);
  }
  assert.equal((await raw(port, { path: "/ui/", headers: { Host: `localhost:${port}` } })).status, 200);
  assert.equal((await raw(port, { path: "/v1/ui/bootstrap", headers: { Host: `localhost:${port}` }, authorized: true })).status, 200);
});

test("anything off the whitelist or outside the directory is not served", async (t) => {
  const { port } = await startUiSidecar(t);
  const notServed = ["/ui/secret.txt", "/ui/main.js.map", "/ui/styles/", "/ui/styles/Upper.css", "/ui/styles/a.b.css", "/ui/fonts/inter.exe", "/ui/gallery.html", "/ui//index.html", "/ui/styles/..%2findex.html", "/ui/%2e%2e/server.js", "/ui/styles/%2e%2e/index.html", "/ui/styles/../index.html", "/ui/../server.js", "/ui/..\\index.html"];
  for (const path of notServed) {
    const response = await raw(port, { path });
    assert.ok(response.status === 404 || response.status === 401, `${path} answered ${response.status}`);
    assert.equal(response.text.includes("extynt"), false, path);
    assert.equal(response.text.includes("top secret"), false, path);
    assert.equal(response.text.includes("gallery"), false, path);
  }
  const authed = await raw(port, { path: "/ui/../server.js", authorized: true });
  assert.equal(authed.status, 404);
});

test("only GET and HEAD are served, and /ui redirects to /ui/", async (t) => {
  const { port } = await startUiSidecar(t);
  const post = await raw(port, { method: "POST", path: "/ui/index.html", body: "{}" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, "GET, HEAD");
  const redirect = await raw(port, { path: "/ui" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.location, "/ui/");
});

test("a symlinked or oversized file is not served", async (t) => {
  const { port, uiDirectory } = await startUiSidecar(t);
  symlinkSync(join(uiDirectory, "secret.txt"), join(uiDirectory, "styles", "link.css"));
  assert.equal((await raw(port, { path: "/ui/styles/link.css" })).status, 404);
  writeFileSync(join(uiDirectory, "main.js"), Buffer.alloc(4 * 1024 * 1024 + 1));
  assert.equal((await raw(port, { path: "/ui/main.js" })).status, 404);
  assert.equal((await raw(port, { path: "/ui/index.html" })).status, 200);
});

test("without a uiDirectory the repository's panel is served and gallery.html is a dev-only page behind EXTYNT_UI_GALLERY", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, panelSessionId: "panel-dev" });
  const { port } = await sidecar.start();
  t.after(() => sidecar.stop());
  const directory = uiDirectoryOf(sidecar);
  assert.ok(existsSync(join(directory, "index.html")));
  assert.equal((await raw(port, { path: "/ui/" })).status, 200);
  assert.equal((await raw(port, { path: "/ui/gallery.html" })).status, 404);
  process.env.EXTYNT_UI_GALLERY = "1";
  t.after(() => { delete process.env.EXTYNT_UI_GALLERY; });
  assert.equal((await raw(port, { path: "/ui/gallery.html" })).status, existsSync(join(directory, "gallery.html")) ? 200 : 404);
});
