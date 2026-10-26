// The installers speak the six languages and tell the panel which one (docs/architecture/ui-languages.md): the Inno Setup
// language files carry the same messages in every language, the macOS pages exist per language, and postinstall maps the
// user's preferred languages to the code written into ui-language.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { ROOT } from "../scripts/lib/sources.ts";

const WINDOWS = join(ROOT, "packaging", "windows");
const MAC = join(ROOT, "packaging", "macos", "release");
const POSTINSTALL = join(MAC, "scripts", "postinstall");
const LANGUAGES = ["en", "es", "de", "fr", "ja", "zh-Hans"];

function messageKeys(text: string): string[] {
  let section = "";
  const keys: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const header = /^\[(\w+)\]$/.exec(line);
    if (header) section = header[1] ?? "";
    else if (section !== "LangOptions" && /^[A-Za-z]\w*=/.test(line)) keys.push(line.slice(0, line.indexOf("=")));
  }
  return keys.sort();
}

const INNO_CUSTOM_MESSAGES: Record<string, string[]> = {
  NameAndVersion: ["%1", "%2"], AdditionalIcons: [], CreateDesktopIcon: [], CreateQuickLaunchIcon: [], ProgramOnTheWeb: ["%1"],
  UninstallProgram: ["%1"], LaunchProgram: ["%1"], AssocFileExtension: ["%1", "%2"], AssocingFileExtension: ["%1", "%2"],
  AutoStartProgramGroupDescription: [], AutoStartProgram: ["%1"], AddonHostProgramNotFound: ["%1"],
};

test("ChineseSimplified.isl translates every Inno custom message with Default.isl's placeholders", () => {
  const text = readFileSync(join(WINDOWS, "languages", "ChineseSimplified.isl"), "utf8");
  for (const [key, expected] of Object.entries(INNO_CUSTOM_MESSAGES)) {
    const line = text.split(/\r?\n/).find((candidate) => candidate.startsWith(`${key}=`));
    assert.ok(line, key);
    assert.deepEqual(placeholders(line), expected, key);
  }
});

function placeholders(text: string): string[] {
  return (text.match(/%\d/g) ?? []).sort();
}

test("every Inno language file has the English messages and the same placeholders", () => {
  const english = readFileSync(join(WINDOWS, "languages", "extynt.en.isl"), "utf8");
  for (const code of LANGUAGES) {
    const text = readFileSync(join(WINDOWS, "languages", `extynt.${code}.isl`), "utf8");
    assert.deepEqual(messageKeys(text), messageKeys(english), code);
    const pairs = english.split(/\r?\n/).filter((line) => line.includes("=") && /%\d/.test(line));
    for (const line of pairs) {
      const key = line.slice(0, line.indexOf("="));
      const mine = text.split(/\r?\n/).find((candidate) => candidate.startsWith(`${key}=`)) ?? "";
      assert.deepEqual(placeholders(mine), placeholders(line), `${code} ${key}`);
    }
  }
});

test("Setup lists the six languages, defaults to the system language and hands the code to the per-user step", () => {
  const script = readFileSync(join(WINDOWS, "extynt.iss"), "utf8");
  for (const name of ["en", "es", "de", "fr", "ja", "zhHans"]) assert.match(script, new RegExp(`^Name: "${name}"; MessagesFile:`, "m"));
  assert.match(script, /^ShowLanguageDialog=auto$/m);
  assert.match(script, /^LanguageDetectionMethod=uilanguage$/m);
  assert.match(script, /'" -UiLanguage ' \+ UiLanguageCode/);
  const parts = readFileSync(join(WINDOWS, "install-parts.ps1"), "utf8");
  assert.match(parts, /function Write-UiLanguage/);
  assert.match(parts, /Join-Path \$StateRoot 'ui-language'/);
  assert.match(readFileSync(join(WINDOWS, "install.ps1"), "utf8"), /Write-UiLanguage \$UiLanguage/);
});

test("the macOS installer has welcome and conclusion pages per language, and the package carries them", () => {
  for (const code of LANGUAGES) {
    for (const page of ["welcome.html", "conclusion.html"]) assert.ok(readFileSync(join(MAC, "text", `${code}.lproj`, page), "utf8").includes("extynt AI tools"), `${code} ${page}`);
  }
  assert.match(readFileSync(join(MAC, "make-release.sh"), "utf8"), /cp -R "\$\{here\}"\/text\/\*\.lproj "\$\{resources\}\/"/);
});

function languageOf(preferred: readonly string[]): string {
  const source = readFileSync(POSTINSTALL, "utf8");
  const functions = /^ui_language_of\(\) \{[\s\S]*?\n\}\n\ninstaller_language\(\) \{[\s\S]*?\n\}\n/m.exec(source)?.[0] ?? "";
  const listing = `(\n${preferred.map((tag) => `    "${tag}",`).join("\n")}\n)`;
  const script = `console_user=nobody\nsudo() { printf '%s\\n' '${listing}'; }\n${functions}\ninstaller_language`;
  return spawnSync("bash", ["-c", script], { encoding: "utf8" }).stdout.trim();
}

test("postinstall maps the preferred languages to the code written into ui-language", () => {
  assert.equal(languageOf(["fr-FR", "en-US"]), "fr");
  assert.equal(languageOf(["zh-Hans-CN"]), "zh-Hans");
  assert.equal(languageOf(["zh-SG"]), "zh-Hans");
  assert.equal(languageOf(["pt-BR", "ja-JP"]), "ja");
  assert.equal(languageOf(["zh-Hant-TW", "de-DE"]), "de");
  assert.equal(languageOf(["pt-BR", "it-IT"]), "");
  assert.match(readFileSync(POSTINSTALL, "utf8"), /tee "\$\{log_dir\}\/ui-language"/);
});
