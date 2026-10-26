#!/usr/bin/env node
/**
 * Deterministic bundle for the panel's TypeScript module graph, plus the manifest of every file the sidecar serves.
 * The sidecar serves one classic script, so a small loader turns the explicit runtime entry into one IIFE. A second
 * bundle, gallery-icons.js, hands the icon table to the standalone design gallery. Both are build outputs, not sources.
 * The emitted artifacts have no Node APIs.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeJson, object, string } from "@extynt/decode";
import { bundleModules, entryModuleId } from "./lib/panel-bundle.ts";
import { ROOT } from "./lib/sources.ts";

const PANEL_ROOT = join(ROOT, "apps", "panel");
const RUNTIME_ROOT = join(PANEL_ROOT, "runtime");
const SERVED_ASSET = /\.(css|woff2?|ttf|otf)$/;
const rootPackage = object({ version: string() });

function productVersion(): string {
  const result = decodeJson(readFileSync(join(ROOT, "package.json"), "utf8"), rootPackage);
  if (!result.ok) throw new Error(`package.json: ${result.error.message}`);
  return result.value.version;
}

function loaderScript(modules: ReadonlyMap<string, string>, entryId: string): string {
  const factories = [...modules].map(([id, code]) => `    ${JSON.stringify(id)}: function (module, exports, require) {\n${code}\n    }`).join(",\n");
  return `(function () {\n  "use strict";\n  var modules = {\n${factories}\n  };\n  var cache = {};\n  function resolveModule(from, request) {\n    if (request.charAt(0) !== ".") return request;\n    var parts = from.split("/");\n    parts.pop();\n    request.split("/").forEach(function (part) {\n      if (!part || part === ".") return;\n      if (part === "..") parts.pop(); else parts.push(part);\n    });\n    return parts.join("/").replace(/\\.js$/, "");\n  }\n  function load(id) {\n    if (cache[id]) return cache[id].exports;\n    if (!modules[id]) throw new Error("Unknown panel module: " + id);\n    var module = { exports: {} };\n    cache[id] = module;\n    var localRequire = function (request) { return load(resolveModule(id, request)); };\n    modules[id](module, module.exports, localRequire);\n    return module.exports;\n  }\n  load(${JSON.stringify(entryId)});\n}());\n`;
}

function mainBundle(): { readonly buildId: string; readonly text: string } {
  const entry = join(RUNTIME_ROOT, "entry.ts");
  const body = `window.__EXTYNT_PRODUCT_VERSION__ = ${JSON.stringify(productVersion())};\n${loaderScript(bundleModules(entry), entryModuleId(entry))}`;
  const buildId = createHash("sha256").update(body).digest("hex").slice(0, 16);
  return { buildId, text: `/* extynt-panel-build:${buildId} */\nwindow.__EXTYNT_PANEL_BUILD_ID__ = ${JSON.stringify(buildId)};\n${body}` };
}

function galleryIconsBundle(): string {
  const entry = join(RUNTIME_ROOT, "gallery-icons.ts");
  return loaderScript(bundleModules(entry), entryModuleId(entry));
}

function servedFiles(directory: string, prefix: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix + entry.name;
    if (entry.isDirectory()) return servedFiles(join(directory, entry.name), `${path}/`);
    return SERVED_ASSET.test(entry.name) ? [path] : [];
  });
}

function manifestText(buildId: string): string {
  const served = ["index.html", "main.js", ...servedFiles(join(PANEL_ROOT, "styles"), "styles/")].sort();
  const files = served.map((file) => {
    const bytes = readFileSync(join(PANEL_ROOT, file));
    return { path: file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  return `${JSON.stringify({ schemaVersion: 1, buildId, files }, null, 2)}\n`;
}

const main = mainBundle();
writeFileSync(join(PANEL_ROOT, "main.js"), main.text, "utf8");
writeFileSync(join(PANEL_ROOT, "gallery-icons.js"), galleryIconsBundle(), "utf8");
writeFileSync(join(PANEL_ROOT, "ui-manifest.json"), manifestText(main.buildId), "utf8");
