/** Tests that the runner fills output paths in command JSON safely on Windows. */
import { isJsonArray } from "@extynt/decode";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { decodeOrThrow } from "@extynt/decode";
import { isJsonObject, jsonObject, type JsonObject, type JsonValue } from "../src/json.js";
import { rawAvi, rawMov, VIDEO_FRAMES } from "../src/video-files.js";

const RUNNER = new URL("../../runner/", import.meta.url).pathname;
const text = (name: string) => readFileSync(`${RUNNER}${name}`, "utf8");

interface RunnerHost {
  substitute: (command: JsonValue, tokens: Record<string, string>) => string;
  withOutDir: (text: string, run: { outFolder: { fsName: string } }, inJson?: boolean) => string;
  fixtureExtension: (name: string) => string;
}

function loadRunner(os: string): RunnerHost {
  const hv = {
    safe: <T>(fn: () => T, fallback: T) => {
      try {
        return fn();
      } catch {
        return fallback;
      }
    },
    has: (target: JsonObject, key: string) => Object.hasOwn(target, key),
    isNewItem: () => false,
    plain: String,
    message: String,
    now: () => 0,
  };
  const context = vm.createContext({ EXTYNT_HV: hv, EXTYNT_LIVE_PACK: { files: {} }, $: { os }, JSON, String });
  vm.runInContext(text("runner-fixture.jsx"), context);
  vm.runInContext(text("runner-case.jsx"), context);
  const run = (code: string): string => String(vm.runInContext(code, context));
  return {
    substitute: (command, tokens) => run(`EXTYNT_HV.substitute(${JSON.stringify(command)}, ${JSON.stringify(tokens)})`),
    withOutDir: (value, folder, inJson) => run(`EXTYNT_HV.withOutDir(${JSON.stringify(value)}, ${JSON.stringify(folder)}, ${String(inJson === true)})`),
    fixtureExtension: (name) => run(`EXTYNT_HV.fixtureExtension(${JSON.stringify(name)})`),
  };
}

function firstOperation(text: string): JsonObject {
  const operations = decodeOrThrow(jsonObject, JSON.parse(text)).operations;
  const first = isJsonArray(operations) ? operations[0] : undefined;
  assert.ok(isJsonObject(first), "the command has a first operation");
  return first;
}

const WINDOWS_FOLDERS = ["C:\\Users\\x\\Documents\\extynt Live Verification\\2026-10-13-run", "\\\\fileserver\\share\\a b\\run"];

test("the runner fills the out-dir placeholder in command JSON with a Windows path the host can parse", () => {
  const hv = loadRunner("Windows NT");
  for (const fsName of WINDOWS_FOLDERS) {
    const step = hv.withOutDir(hv.substitute({ operations: [{ operation: "import_file", path: "/EXTYNT_OUT_DIR/png-red.png" }] }, {}), { outFolder: { fsName } }, true);
    assert.equal(firstOperation(step).path, `${fsName}/png-red.png`);
  }
  assert.equal(hv.withOutDir("/EXTYNT_OUT_DIR/x.png", { outFolder: { fsName: WINDOWS_FOLDERS[0] ?? "" } }), `${WINDOWS_FOLDERS[0]}/x.png`);
});

test("substitute escapes token values, so a Windows path token stays valid JSON", () => {
  const hv = loadRunner("Windows NT");
  const preset = "C:\\Program Files\\Adobe\\Support Files\\Presets\\Text\\Fade \"in\".ffx";
  const operation = firstOperation(hv.substitute({ operations: [{ target: "@custom:path", itemId: "@item:red" }] }, { "@custom:path": preset, "@item:red": "12" }));
  assert.equal(operation.target, preset);
  assert.equal(operation.itemId, "12");
});

test("fixture files are written with the extension of their container", () => {
  const hv = loadRunner("Windows NT");
  assert.deepEqual(["png-red", "wav-tone", "video-avi", "video-mov"].map(hv.fixtureExtension), [".png", ".wav", ".avi", ".mov"]);
});

test("the video fixtures are well-formed containers holding every frame", () => {
  const avi = rawAvi();
  assert.equal(avi.toString("ascii", 0, 4), "RIFF");
  assert.equal(avi.readUInt32LE(4), avi.length - 8);
  assert.equal(avi.toString("ascii", 8, 12), "AVI ");
  assert.equal(avi.toString("latin1").split("00db").length - 1 >= VIDEO_FRAMES, true);
  const mov = rawMov();
  let offset = 0; const kinds: string[] = [];
  while (offset < mov.length) { const size = mov.readUInt32BE(offset); kinds.push(mov.toString("ascii", offset + 4, offset + 8)); assert.ok(size >= 8); offset += size; }
  assert.equal(offset, mov.length);
  assert.deepEqual(kinds, ["ftyp", "mdat", "moov"]);
});
