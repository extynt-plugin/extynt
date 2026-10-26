// native/extynt-core/tests/syntax-check/stubs: every Cocoa/WebKit/UniformTypeIdentifiers symbol the ae/*.mm sources use
// must be declared by a stand-in header, or the Linux syntax check fails on the first undeclared name (B-09).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const aeDir = join(root, "native/extynt-core/ae");
const stubDir = join(root, "native/extynt-core/tests/syntax-check/stubs");

function filesUnder(dir: string, extension: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path, extension);
    return path.endsWith(extension) ? [path] : [];
  });
}

function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").replace(/@?"(?:\\.|[^"\\\n])*"/g, '""').replace(/'(?:\\.|[^'\\\n])*'/g, "''");
}

const SYMBOL = /\b(?:NS|UT|WK)[A-Z][A-Za-z0-9]*\b/g;
const stubText = filesUnder(stubDir, ".h").map((file: string) => code(readFileSync(file, "utf8"))).join("\n");
const declared = new Set(stubText.match(SYMBOL) ?? []);

test("the stand-in headers declare every NS/UT/WK symbol the ae/*.mm sources use", () => {
  const sources = filesUnder(aeDir, ".mm");
  assert.ok(sources.length > 0, "no .mm sources found");
  const missing: string[] = [];
  for (const file of sources) {
    const used = new Set(code(readFileSync(file, "utf8")).match(SYMBOL) ?? []);
    for (const symbol of [...used].sort()) if (!declared.has(symbol)) missing.push(`${file.slice(root.length + 1)}: ${symbol}`);
  }
  assert.deepEqual(missing, []);
});

test("the engine-hide sources' Cocoa selectors have declarations in the stand-in Cocoa", () => {
  const cocoa = code(readFileSync(join(stubDir, "Cocoa/Cocoa.h"), "utf8"));
  const used = code(readFileSync(join(aeDir, "ae_engine_hide_mac.mm"), "utf8"));
  const selectors = [
    "setActivationPolicy:", "activationPolicy", "deactivate", "orderOut:", "abortModal",
    "timerWithTimeInterval:repeats:block:", "mainRunLoop", "addTimer:forMode:",
  ];
  for (const selector of selectors) {
    const name = selector.split(":")[0];
    assert.ok(new RegExp(`\\b${name}\\b`).test(used), `${selector} is no longer used by ae_engine_hide_mac.mm; drop it from this list`);
    assert.ok(cocoa.includes(selector.includes(":") ? `${selector.split(":")[0]}:` : selector), `${selector} is not declared in stubs/Cocoa/Cocoa.h`);
  }
  assert.ok(/\bactive\b/.test(cocoa) && /\bwindows\b/.test(cocoa) && /\btitle\b/.test(cocoa), "NSApplication active/windows and NSWindow title must be declared");
});

test("the syntax-check script keeps going after a failing file and lists every failure", () => {
  const script = readFileSync(join(root, "native/extynt-core/tests/syntax-check/check-ae-syntax.sh"), "utf8");
  assert.match(script, /failed_files\+=\("\$file"\)/);
  assert.match(script, /FAILED: \$\{#failed_files\[@\]\} file\(s\) did not pass/);
});
