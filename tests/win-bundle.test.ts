// The Windows bundle builder's parts (scripts/build-win-bundle.ts and its libraries) and static properties of packaging/windows.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { fileVersionOf } from "../scripts/build-win-bundle.ts";
import { BUNDLED_SCRIPTS, stageInstallerFiles, stageSidecar } from "../scripts/lib/win-bundle-stage.ts";
import { ROOT } from "../scripts/lib/sources.ts";
import { parseRuntimeEnv, windowsNodePin } from "../scripts/lib/win-bundle-node.ts";
import { CATALOGUE_WINDOW_DIRECTORY, CATALOGUE_WINDOW_FILE, defaultCatalogueWindowPath, stageCatalogueWindow } from "../scripts/lib/win-bundle-catalogue-window.ts";
import { extractTopLevelFile, zipEntries } from "../scripts/lib/zip-entry.ts";
import { THIRD_PARTY_LICENSES, assertNoticeMatchesPayload, noticeReferencedLicenses, stageThirdPartyLicenses } from "../scripts/lib/third-party-licenses.ts";

interface ZipEntryFixture {
  readonly name: string;
  readonly data: Buffer;
  readonly stored?: boolean;
  readonly badCrc?: boolean;
}

function buildZip(entries: readonly ZipEntryFixture[]) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const body = entry.stored ? entry.data : deflateRawSync(entry.data);
    const crc = entry.badCrc ? 1 : crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.stored ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.stored ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test("zip entries are listed and extracted, deflated or stored, ignoring the top-level folder", () => {
  const zip = buildZip([
    { name: "node-v1/", data: Buffer.alloc(0), stored: true },
    { name: "node-v1/node.exe", data: Buffer.from("MZ".repeat(500)) },
    { name: "node-v1/LICENSE", data: Buffer.from("licence text"), stored: true },
    { name: "node-v1/deep/node.exe", data: Buffer.from("not this one") },
  ]);
  assert.equal(zipEntries(zip).length, 4);
  assert.equal(extractTopLevelFile(zip, "node.exe").toString(), "MZ".repeat(500));
  assert.equal(extractTopLevelFile(zip, "LICENSE").toString(), "licence text");
  assert.throws(() => extractTopLevelFile(zip, "missing.exe"), /no missing\.exe/);
});

test("a corrupt entry fails its CRC check and a non-zip is rejected", () => {
  assert.throws(() => extractTopLevelFile(buildZip([{ name: "a/node.exe", data: Buffer.from("MZ data"), badCrc: true }]), "node.exe"), /CRC-32/);
  assert.throws(() => zipEntries(Buffer.from("this is not a zip file at all, just text")), /not a zip/);
});

test("the Windows Node pin is well formed and matches the macOS version", () => {
  const pin = windowsNodePin(ROOT);
  assert.match(pin.sha256, /^[0-9a-f]{64}$/);
  const mac = parseRuntimeEnv(readFileSync(join(ROOT, "packaging", "macos", "node-runtime.env"), "utf8"));
  assert.equal(pin.version, mac.get("NODE_VERSION"));
});

test("runtime env files ignore comments and blank lines", () => {
  const values = parseRuntimeEnv("# comment\n\nNODE_VERSION=24.0.0\nNODE_SHA256_WIN_X64=abc\n");
  assert.deepEqual([...values], [["NODE_VERSION", "24.0.0"], ["NODE_SHA256_WIN_X64", "abc"]]);
});

test("the installer file version is numeric and keeps the letter suffix as the fourth part", () => {
  assert.equal(fileVersionOf("0.9.9"), "0.9.9.0");
  assert.equal(fileVersionOf("0.9.8a"), "0.9.8.1");
  assert.equal(fileVersionOf("0.9.8e"), "0.9.8.5");
  assert.equal(fileVersionOf("0.9.8t"), "0.9.8.20");
  assert.equal(fileVersionOf("0.9.8z"), "0.9.8.26");
  assert.notEqual(fileVersionOf("0.9.8e"), fileVersionOf("0.9.8t"));
  assert.throws(() => fileVersionOf("beta"), /major\.minor\.patch/);
});

test("the Windows scripts avoid Invoke-Expression, run the launcher through cmd.exe, and sets development only for -DevLibrary", () => {
  const directory = join(ROOT, "packaging", "windows");
  const scripts = readdirSync(directory).filter((name) => name.endsWith(".ps1")).map((name): [string, string] => [name, readFileSync(join(directory, name), "utf8")]);
  for (const [name, text] of scripts) assert.doesNotMatch(text, /Invoke-Expression|\biex\b/i, `${name} must not use Invoke-Expression`);
  const parts = readFileSync(join(directory, "install-parts.ps1"), "utf8");
  assert.match(parts, /--headless cmd\.exe \/d \/c/);
  assert.match(parts, /NODE_ENV=production/);
  assert.match(parts, /SecurityElement\]::Escape/);
  assert.match(parts, /\$Development\) \{ @\('set "NODE_ENV=development"'\)/);
});

test("the Inno Setup script installs per machine, runs the per-user steps as the user, is x64-only, publishes as extynt, and names no signer", () => {
  const script = readFileSync(join(ROOT, "packaging", "windows", "extynt.iss"), "utf8");
  assert.match(script, /^PrivilegesRequired=admin$/m);
  assert.match(script, /^DefaultDirName=\{autopf\}\\extynt$/m);
  assert.match(script, /RunScriptAsUser\(ExpandConstant\('\{app\}\\installer\\install\.ps1'\)/);
  assert.match(script, /^ArchitecturesAllowed=x64os$/m);
  assert.match(script, /^AppPublisher=extynt$/m);
  assert.match(script, /^OutputBaseFilename=extynt-\{#AppVersion\}-setup$/m);
  assert.doesNotMatch(script, /^SignTool=(?!\{#SignToolName\})/m);
  assert.match(script, /ExpandConstant\('\{commonappdata\}\\extynt\\bin'\)/);
  assert.match(script, /if not WriteMcpLauncher then/);
});

test("the scheduled task is named per Windows account, and uninstall removes every account's task and state folder", () => {
  const directory = join(ROOT, "packaging", "windows");
  const common = readFileSync(join(directory, "common.ps1"), "utf8");
  assert.match(common, /\$TaskName = "\$TaskPrefix " \+ \(\$env:USERNAME -replace '\[\^A-Za-z0-9\._-\]', '_'\)/);
  assert.match(common, /function Get-SidecarTaskNames/);
  assert.match(common, /function Get-SidecarStateRoots/);
  const uninstall = readFileSync(join(directory, "uninstall.ps1"), "utf8");
  assert.match(uninstall, /Get-SidecarTaskNames/);
  assert.match(uninstall, /foreach \(\$root in \$stateRoots\) \{ Remove-AccountState \$root \}/);
  const script = readFileSync(join(directory, "extynt.iss"), "utf8");
  assert.doesNotMatch(script, /TaskName = 'extynt sidecar'/);
  assert.match(script, /^function InitializeUninstall: Boolean;$/m);
  assert.match(script, /if AfterEffectsIsRunning then/);
});

test("the welcome text presents extynt AI tools, After Effects first, more tools coming, and each user sets up their own panel", () => {
  const windows = readFileSync(join(ROOT, "packaging", "windows", "languages", "extynt.en.isl"), "utf8");
  const mac = readFileSync(join(ROOT, "packaging", "macos", "release", "text", "en.lproj", "welcome.html"), "utf8");
  for (const text of [windows, mac]) {
    assert.match(text, /extynt AI tools for every user on this (PC|Mac)\. The first one is for After Effects/);
    assert.match(text, /Each user runs this installer once from their own account to set up the panel/);
    assert.equal(text.split("More tools are coming").length - 1, 1, "More tools are coming is said once");
  }
  assert.doesNotMatch(windows, /For every user on this PC/);
  assert.doesNotMatch(mac, /For every user on this Mac/);
});

function licenseRoot() {
  const root = mkdtempSync(join(tmpdir(), "extynt-license-root-"));
  for (const file of ["NOTICE", ...THIRD_PARTY_LICENSES.map((license) => license.source)]) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    cpSync(join(ROOT, file), join(root, file));
  }
  return root;
}

test("NOTICE points only at licenses/ files the staged payload holds, and the payload holds every one", () => {
  const root = licenseRoot();
  const bundle = mkdtempSync(join(tmpdir(), "extynt-license-bundle-"));
  try {
    writeFileSync(join(bundle, "node-license"), "node license text\n");
    stageThirdPartyLicenses(root, bundle, join(bundle, "node-license"));
    const notice = readFileSync(join(bundle, "NOTICE"), "utf8");
    const referenced = noticeReferencedLicenses(notice);
    assert.deepEqual(referenced, ["licenses/AEQUERY-LICENSE.txt", "licenses/node-LICENSE.txt", "licenses/xxhash-LICENSE.txt"]);
    for (const path of referenced) assert.ok(existsSync(join(bundle, path)), `${path} is staged`);
    assert.match(readFileSync(join(bundle, "licenses", "xxhash-LICENSE.txt"), "utf8"), /BSD 2-Clause/);
    assert.doesNotMatch(notice, /third_party/, "NOTICE must not point at source-repository folders a recipient never receives");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(bundle, { recursive: true, force: true });
  }
});

test("a missing or empty license, or a NOTICE that drifts from the payload, fails the staging", () => {
  const bundle = mkdtempSync(join(tmpdir(), "extynt-license-bundle-"));
  const nodeLicense = join(bundle, "node-license");
  writeFileSync(nodeLicense, "node license text\n");
  try {
    for (const missing of ["NOTICE", ...THIRD_PARTY_LICENSES.map((license) => license.source)]) {
      const root = licenseRoot();
      try {
        rmSync(join(root, missing));
        assert.throws(() => stageThirdPartyLicenses(root, bundle, nodeLicense), /is missing/, missing);
        writeFileSync(join(root, missing), "");
        assert.throws(() => stageThirdPartyLicenses(root, bundle, nodeLicense), /is empty/, missing);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
    const root = licenseRoot();
    try {
      assert.throws(() => stageThirdPartyLicenses(root, bundle, join(bundle, "no-such-license")), /Node\.js runtime license is missing/);
      writeFileSync(join(root, "NOTICE"), "xxHash\n  licenses/xxhash-LICENSE.txt\n  licenses/not-shipped.txt\n");
      assert.throws(() => stageThirdPartyLicenses(root, bundle, nodeLicense), /not-shipped\.txt \(referenced by NOTICE\) is missing/);
      writeFileSync(join(root, "NOTICE"), "xxHash\n  licenses/xxhash-LICENSE.txt\n");
      assert.throws(() => stageThirdPartyLicenses(root, bundle, nodeLicense), /NOTICE does not mention licenses\/AEQUERY/);
      assert.throws(() => assertNoticeMatchesPayload(join(bundle, "empty")), /payload NOTICE is missing/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  } finally {
    rmSync(bundle, { recursive: true, force: true });
  }
});

test("build-win-bundle stages the licenses after the Node runtime", () => {
  const source = readFileSync(join(ROOT, "scripts", "lib", "win-bundle-build.ts"), "utf8");
  assert.ok(source.indexOf("stageNodeRuntime(") < source.indexOf("stageThirdPartyLicenses(ROOT"));
});

test("the catalogue window is staged from the build output, and a missing or non-PE file refuses the bundle", () => {
  const root = mkdtempSync(join(tmpdir(), "extynt-window-"));
  const aex = join(root, "build", "ae", "Release", "extyntcore.aex");
  const built = join(root, "build", "catalogue-window", "Release");
  assert.equal(defaultCatalogueWindowPath(aex), join(built, CATALOGUE_WINDOW_FILE));
  const bundle = join(root, "bundle");
  assert.throws(() => stageCatalogueWindow(defaultCatalogueWindowPath(aex), bundle), /does not exist/);
  mkdirSync(built, { recursive: true });
  writeFileSync(join(built, CATALOGUE_WINDOW_FILE), "not an executable");
  assert.throws(() => stageCatalogueWindow(defaultCatalogueWindowPath(aex), bundle), /no MZ header/);
  writeFileSync(join(built, CATALOGUE_WINDOW_FILE), Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64)]));
  stageCatalogueWindow(defaultCatalogueWindowPath(aex), bundle);
  assert.equal(readFileSync(join(bundle, CATALOGUE_WINDOW_DIRECTORY, CATALOGUE_WINDOW_FILE)).subarray(0, 2).toString("latin1"), "MZ");
});

test("the bundle builder requires the catalogue window and the installer opens it after the sidecar is proven", () => {
  const builder = readFileSync(join(ROOT, "scripts", "lib", "win-bundle-build.ts"), "utf8");
  assert.match(readFileSync(join(ROOT, "scripts", "build-win-bundle.ts"), "utf8"), /"--catalogue-window": "catalogueWindow"/);
  assert.match(builder, /stageCatalogueWindow\(options\.catalogueWindow, bundle\)/);
  const directory = join(ROOT, "packaging", "windows");
  const install = readFileSync(join(directory, "install.ps1"), "utf8");
  assert.match(install, /Start-AndProveSidecar \$layout\r?\nOpen-CatalogueWindow \$layout\r?\nWrite-NextSteps \$layout/);
  assert.match(install, /Stop-CatalogueEngines[^\n]*\r?\n[^\n]*Stop-CatalogueWindow[^\n]*\r?\n\s*Assert-AfterEffectsClosed/);
  const parts = readFileSync(join(directory, "install-parts.ps1"), "utf8");
  assert.match(parts, /function Open-CatalogueWindow/);
  assert.match(parts, /catalogue-window\\extynt Catalogue\.exe/);
  assert.match(parts, /The effect catalogue window did not open; the catalogue runs when After Effects next starts\./);
  assert.match(parts, /<Priority>5<\/Priority>/);
});

test("the Windows installer ships the window, ignores the hidden engine, and ends both before replacing files", () => {
  const directory = join(ROOT, "packaging", "windows");
  const script = readFileSync(join(directory, "extynt.iss"), "utf8");
  assert.match(script, /Source: "\{#BundleDir\}\\\*"; DestDir: "\{app\}"; Flags: recursesubdirs/);
  assert.match(script, /native-engine\.json/);
  assert.match(script, /Where-Object \{ \$_\.Id -ne \$p \}/);
  assert.match(script, /Get-Process -Id \$p [^\n]*ProcessName -eq ''AfterFX''/);
  assert.doesNotMatch(script, /CommandLine|extynt_engine/);
  assert.match(script, /procedure StopCatalogue;/);
  assert.match(script, /taskkill\.exe \/PID \$_\.Id \/T \/F/);
  assert.match(script, /\{app\}\\catalogue-window\\extynt Catalogue\.exe/);
  assert.match(script, /StopCatalogue;\r?\n  if ProtectHostParent then/);
  const english = readFileSync(join(directory, "languages", "extynt.en.isl"), "utf8");
  assert.match(english, /^WelcomeEyebrow=FOR AFTER EFFECTS 2025 AND 2026$/m);
  assert.match(english, /^FinishedEyebrow=INSTALLED$/m);
  assert.match(english, /^FinishedHeadingLabel=extynt AI tools are installed$/m);
  assert.match(english, /^FinishedLabel=Restart After Effects, then choose Window > extynt\.%n%nIf you're going to use AI, use protection\.$/m);
  assert.match(english, /^FinishedLabelNoIcons=Restart After Effects, then choose Window > extynt\.%n%nIf you're going to use AI, use protection\.$/m);
  assert.match(english, /To connect an AI agent \(any MCP client\), open After Effects > Window > extynt > Settings > Agents\./);
  assert.match(script, /unins000\.exe/);
  const common = readFileSync(join(directory, "common.ps1"), "utf8");
  assert.match(common, /function Stop-CatalogueEngines/);
  assert.match(common, /function Get-CatalogueEnginePid/);
  assert.match(common, /native-engine\.json/);
  assert.match(common, /\$process\.ProcessName -eq 'AfterFX'/);
  assert.doesNotMatch(common, /CommandLine|extynt_engine/);
  assert.match(common, /taskkill/);
  assert.match(common, /function Stop-CatalogueWindow/);
  const uninstall = readFileSync(join(directory, "uninstall.ps1"), "utf8");
  assert.match(uninstall, /Stop-CatalogueWindow/);
  assert.match(uninstall, /Stop-CatalogueEngines/);
});

test("run-sidecar.cmd hands Node to the supervisor, which owns the back-off, the cap and the stop marker", () => {
  const parts = readFileSync(join(ROOT, "packaging", "windows", "install-parts.ps1"), "utf8");
  const launcher = /function Get-SidecarLauncherLines[\s\S]*?\n\}/.exec(parts)?.[0] ?? "";
  assert.match(launcher, /windows-supervisor-main\.js/);
  assert.match(launcher, /\$SupervisorStopFile/);
  assert.match(launcher, /'exit \/b %ERRORLEVEL%'/);
  assert.doesNotMatch(launcher, /ping|timeout|goto run|DELAY/);
  assert.match(parts, /<RestartOnFailure>/);
  assert.match(parts, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
});

test("every schtasks /End on the sidecar task is preceded by the supervisor stop marker", () => {
  const common = readFileSync(join(ROOT, "packaging", "windows", "common.ps1"), "utf8");
  assert.match(common, /function Set-SupervisorStop/);
  assert.match(common, /\$SupervisorStopFile = Join-Path \$StateRoot 'supervisor\.stop'/);
  const parts = readFileSync(join(ROOT, "packaging", "windows", "install-parts.ps1"), "utf8");
  assert.match(parts, /Set-SupervisorStop \$StateRoot\r?\n  if \(Test-TaskRegistered\) \{ Invoke-Schtasks @\('\/End'/);
  const uninstall = readFileSync(join(ROOT, "packaging", "windows", "uninstall.ps1"), "utf8");
  assert.match(uninstall, /foreach \(\$root in \$stateRoots\) \{ Set-SupervisorStop \$root \}\r?\n/);
  assert.ok(uninstall.indexOf("Set-SupervisorStop") < uninstall.indexOf("'/End'"));
  const stopScript = readFileSync(join(ROOT, "scripts", "stop-local-sidecar.ts"), "utf8");
  assert.match(stopScript, /"supervisor\.stop"/);
  assert.ok(stopScript.indexOf("markSupervisorStopped();") < stopScript.indexOf('"/End"'));
});

function bareImports(source: string): string[] {
  const specifiers = [...source.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gm)].map((match) => match[1] ?? "");
  return specifiers.filter((specifier) => !specifier.startsWith(".") && !specifier.startsWith("node:"));
}

function packageNameOf(specifier: string): string {
  return specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0] ?? specifier;
}

function resolvesFrom(directory: string, name: string, bundle: string): boolean {
  for (let current = directory; current.startsWith(bundle); current = dirname(current)) {
    if (existsSync(join(current, "node_modules", name, "package.json"))) return true;
  }
  return false;
}

test("every script the bundle ships resolves its package imports from where the bundle puts it", () => {
  const root = mkdtempSync(join(tmpdir(), "extynt-bundle-scripts-"));
  const bundle = join(root, "bundle");
  try {
    mkdirSync(join(root, "apps", "sidecar", "dist", "src"), { recursive: true });
    writeFileSync(join(root, "apps", "sidecar", "package.json"), "{}");
    for (const name of readdirSync(join(ROOT, "packages"))) {
      mkdirSync(join(root, "packages", name, "dist", "src"), { recursive: true });
      cpSync(join(ROOT, "packages", name, "package.json"), join(root, "packages", name, "package.json"));
    }
    mkdirSync(join(root, "packaging", "windows"), { recursive: true });
    mkdirSync(join(root, "scripts"), { recursive: true });
    for (const name of BUNDLED_SCRIPTS) cpSync(join(ROOT, "scripts", name), join(root, "scripts", name));
    stageSidecar(root, bundle);
    stageInstallerFiles(root, bundle);
    for (const name of BUNDLED_SCRIPTS) {
      const staged = join(bundle, "sidecar", "scripts", name);
      assert.ok(existsSync(staged), `${name} is not staged`);
      for (const specifier of bareImports(readFileSync(staged, "utf8"))) {
        assert.ok(resolvesFrom(dirname(staged), packageNameOf(specifier), bundle), `${name} imports ${specifier}, which the bundle cannot resolve from sidecar/scripts`);
      }
    }
    const layout = readFileSync(join(ROOT, "packaging", "windows", "install-parts.ps1"), "utf8");
    assert.match(layout, /StopScript = Join-Path \$sidecar 'scripts\\stop-local-sidecar\.ts'/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the bundle entry script loads before any workspace package is built", () => {
  const entry = join(ROOT, "scripts", "build-win-bundle.ts");
  const sources = [entry, join(ROOT, "scripts", "lib", "win-bundle-catalogue-window.ts"), join(ROOT, "scripts", "lib", "win-bundle-version.ts")];
  for (const file of sources) assert.doesNotMatch(readFileSync(file, "utf8"), /from "@extynt\//, `${file} imports a workspace package`);
  assert.match(readFileSync(entry, "utf8"), /await import\("\.\/lib\/win-bundle-build\.ts"\)/);
});
