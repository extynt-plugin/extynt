/** The Mac release script and the package scripts: identity resolution and the root installer flow. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const MAKE_RELEASE = join(process.cwd(), "packaging/macos/release/make-release.sh");
const RELEASE_DIR = "packaging/macos/release";
const APP = "Developer ID Application: Example Person (ABCDE12345)";
const INSTALLER = "Developer ID Installer: Example Person (ABCDE12345)";

interface Outcome { status: number | null; output: string }

function script(path: string, body: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
}

function tempDir(t: test.TestContext, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `extynt-${name}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakeSecurity(root: string, names: string[]): string {
  const lines = names.map((name, index) => `  ${index + 1}) ${"A".repeat(40)} "${name}"`).join("\n");
  script(join(root, "bin", "security"), `cat <<'LIST'\n${lines}\n     ${names.length} valid identities found\nLIST`);
  return join(root, "bin");
}

function run(command: string[], env: Record<string, string>): Outcome {
  const result = spawnSync("bash", command, { env: { ...process.env, ...env }, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function dryRun(t: test.TestContext, names: string[], env: Record<string, string> = {}, flags: string[] = []): Outcome {
  const root = tempDir(t, "release");
  const path = `${fakeSecurity(root, names)}:${process.env.PATH ?? ""}`;
  return run([MAKE_RELEASE, "--dry-run", ...flags], { PATH: path, EXTYNT_RELEASE_OUT: join(root, "out"), EXTYNT_SIGN_APP: "", EXTYNT_SIGN_INSTALLER: "", ...env });
}

test("make-release resolves the single Application and Installer identities from the keychain", (t) => {
  const result = dryRun(t, [APP, INSTALLER, "Apple Development: Someone (ZZZZZZ)"]);
  assert.equal(result.status, 0, result.output);
  assert.ok(result.output.includes(`plugin signed by   ${APP}`), result.output);
  assert.ok(result.output.includes(`package signed by  ${INSTALLER}`), result.output);
  assert.ok(result.output.includes("notarization       profile extynt-notary, then stapler"), result.output);
});

test("make-release prefers EXTYNT_SIGN_APP and honours --no-notarize", (t) => {
  const other = "Developer ID Application: Other Name (QQQQQ99999)";
  const result = dryRun(t, [APP, other, INSTALLER], { EXTYNT_SIGN_APP: other }, ["--no-notarize"]);
  assert.equal(result.status, 0, result.output);
  assert.ok(result.output.includes(`plugin signed by   ${other}`), result.output);
  assert.ok(result.output.includes("skipped (--no-notarize)"), result.output);
});

test("make-release fails with a clear message when an identity is missing, ambiguous or of the wrong kind", (t) => {
  const missing = dryRun(t, [APP]);
  assert.notEqual(missing.status, 0);
  assert.ok(missing.output.includes('No "Developer ID Installer" identity'), missing.output);
  const ambiguous = dryRun(t, [APP, "Developer ID Application: Second (BBBBB22222)", INSTALLER]);
  assert.notEqual(ambiguous.status, 0);
  assert.ok(ambiguous.output.includes("Export EXTYNT_SIGN_APP"), ambiguous.output);
  const wrongKind = dryRun(t, [], { EXTYNT_SIGN_APP: INSTALLER, EXTYNT_SIGN_INSTALLER: INSTALLER });
  assert.notEqual(wrongKind.status, 0);
  assert.ok(wrongKind.output.includes("must name a"), wrongKind.output);
});

test("make-release builds the bundle and carries no signer's name", () => {
  const source = readFileSync(MAKE_RELEASE, "utf8");
  assert.match(source, /EXTYNT_ARCH=.*scripts\/build-mac-bundle\.sh/);
  assert.match(source, /notarytool submit .*--keychain-profile "\$\{notary_profile\}" --wait/);
  assert.match(source, /stapler staple/);
  assert.match(source, /productsign --timestamp --sign "\$\{sign_installer\}"/);
  assert.equal(/\(\s*[A-Z0-9]{10}\s*\)/.test(source), false, "no team id");
});

test("distribution.xml installs in the system domain only and runs nothing that makes Installer warn", () => {
  const distribution = readFileSync(join(RELEASE_DIR, "distribution.xml"), "utf8");
  assert.doesNotMatch(distribution, /&(?![a-zA-Z]+;|#[0-9]+;)/, "a bare & makes the file unreadable to productbuild");
  assert.match(distribution, /enable_currentUserHome="false" enable_localSystem="true"/);
  assert.match(distribution, /<pkg-ref [^>]*auth="root"/);
  assert.doesNotMatch(distribution, /<script|installation-check|volume-check script/);
  assert.doesNotMatch(readFileSync(join(RELEASE_DIR, "make-release.sh"), "utf8"), /--plugins/);
});

test("the catalogue window is a signed app in the bundle that postinstall opens as the user, after the install is done", () => {
  const info = readFileSync(join(RELEASE_DIR, "catalogue-window", "Info.plist"), "utf8");
  assert.match(info, /<key>CFBundlePackageType<\/key><string>APPL<\/string>/);
  assert.match(info, /<key>LSUIElement<\/key><true\/>/, "no Dock icon");
  const release = readFileSync(join(RELEASE_DIR, "make-release.sh"), "utf8");
  assert.match(release, /codesign [^\n]*--options runtime [^\n]*"\$\{app\}"/);
  assert.ok(release.indexOf("  build_catalogue_window\n") < release.indexOf("  refresh_checksums\n"), "the app is in the bundle's checksums");
});

interface PkgRig { root: string; env: Record<string, string>; systemRoot: string; calls: string; home: string }

function pkgRig(t: test.TestContext, consoleUser: string): PkgRig {
  const root = tempDir(t, "pkg"), bin = join(root, "bin");
  const home = join(root, "home"), systemRoot = join(root, "Library", "Application Support"), calls = join(root, "calls.log");
  mkdirSync(home, { recursive: true });
  script(join(systemRoot, "extynt", "installer", "9.9.9", "install.sh"), `echo "install.sh $* ctx=$EXTYNT_INSTALL_CONTEXT sudo=\${EXTYNT_SUDO:-} home=$HOME" >> '${calls}'`);
  script(join(systemRoot, "extynt", "installer", "9.9.9", "uninstall.sh"), "exit 0");
  script(join(systemRoot, "extynt", "installer", "9.8.0", "install.sh"), "exit 0");
  script(join(bin, "stat"), `echo '${consoleUser}'`);
  script(join(bin, "dscl"), `echo 'NFSHomeDirectory: ${home}'`);
  script(join(bin, "id"), "echo 501");
  script(join(bin, "chown"), "exit 0");
  script(join(bin, "sudo"), `echo "sudo $*" >> '${calls}'; while [ $# -gt 0 ] && [ "$1" != env ] && [ "$1" != mkdir ] && [ "$1" != touch ]; do shift; done; [ $# -gt 0 ] || exit 0; exec "$@"`);
  script(join(bin, "launchctl"), `echo "launchctl $*" >> '${calls}'; shift 2; exec "$@"`);
  const env = { PATH: `${bin}:${process.env.PATH ?? ""}`, EXTYNT_SYSTEM_SUPPORT_DIR: systemRoot, HOME: root };
  return { root, env, systemRoot, calls, home };
}

function postinstall(setup: PkgRig): Outcome {
  const text = readFileSync(join(RELEASE_DIR, "scripts", "postinstall"), "utf8").replace("__VERSION__", "9.9.9");
  const file = join(setup.root, "postinstall");
  writeFileSync(file, text, { mode: 0o755 });
  return run([file], setup.env);
}

test("postinstall runs the root half, then the user half in the console user's session, and keeps only this payload", (t) => {
  const setup = pkgRig(t, "dana");
  const result = postinstall(setup);
  assert.equal(result.status, 0, result.output);
  const calls = readFileSync(setup.calls, "utf8");
  assert.ok(calls.includes(`install.sh --system-only ctx=pkg sudo=env home=${setup.home}`), calls);
  assert.ok(calls.includes("launchctl asuser 501 sudo -u dana -H env"), calls);
  assert.ok(calls.indexOf("--system-only") < calls.indexOf("--user-only"), calls);
  const opened = calls.indexOf("launchctl asuser 501 sudo -u dana -H /usr/bin/open -n");
  assert.ok(opened > calls.indexOf("--user-only") && calls.includes("installer/9.9.9/catalogue-window/extynt Catalogue.app"), calls);
  assert.equal(existsSync(join(setup.systemRoot, "extynt", "installer", "9.8.0")), false);
  assert.equal(existsSync(join(setup.systemRoot, "extynt", "uninstall.sh")), true);
  assert.ok(readFileSync(join(setup.home, "Library/Application Support/extynt/installer.log"), "utf8").includes("extynt installer 9.9.9"));
});

test("postinstall and preinstall refuse to run without a signed-in console user", (t) => {
  for (const user of ["root", "loginwindow"]) {
    const setup = pkgRig(t, user);
    const post = postinstall(setup);
    assert.notEqual(post.status, 0);
    assert.ok(post.output.includes("nobody is signed in"), post.output);
    assert.equal(existsSync(setup.calls), false);
    const pre = run([join(RELEASE_DIR, "scripts", "preinstall")], { ...setup.env, EXTYNT_APPLICATIONS_DIR: join(setup.root, "Applications") });
    assert.notEqual(pre.status, 0);
    assert.ok(pre.output.includes("sign in at the Mac's console"), pre.output);
  }
});

test("preinstall needs a supported After Effects", (t) => {
  const setup = pkgRig(t, "dana"), applications = join(setup.root, "Applications");
  const env = { ...setup.env, EXTYNT_APPLICATIONS_DIR: applications };
  const none = run([join(RELEASE_DIR, "scripts", "preinstall")], env);
  assert.notEqual(none.status, 0);
  assert.ok(none.output.includes("After Effects 2025 or 2026"), none.output);
  mkdirSync(join(applications, "Adobe After Effects 2026", "Adobe After Effects 2026.app"), { recursive: true });
  assert.equal(run([join(RELEASE_DIR, "scripts", "preinstall")], env).status, 0);
});

function installRig(t: test.TestContext): { bundle: string; env: Record<string, string>; applications: string; library: string; calls: string } {
  const root = tempDir(t, "install"), bin = join(root, "bin"), bundle = join(root, "bundle"), calls = join(root, "calls.log");
  const applications = join(root, "Applications"), library = join(root, "root-library", "host");
  for (const directory of ["sidecar", "ui", "host", "plugin/extyntcore.plugin/Contents"]) mkdirSync(join(bundle, directory), { recursive: true });
  writeFileSync(join(bundle, "install.sh"), readFileSync("packaging/macos/install.sh"), { mode: 0o755 });
  script(join(bundle, "verify-checksums.sh"), "exit 0");
  script(join(bundle, "sidecar-launchd", "install-sidecar.sh"), `echo "install-sidecar" >> '${calls}'`);
  writeFileSync(join(bundle, "host", "manifest.json"), '{"schema":"extynt-host-library/1","version":"9.9.9+abc","entry":"probe.jsx"}\n');
  writeFileSync(join(bundle, "host", "probe.jsx"), "// entry\n");
  script(join(bin, "uname"), "echo Darwin");
  script(join(bin, "ditto"), 'for last; do :; done; src=""; for each; do case "$each" in -*) ;; *) [ -z "$src" ] && src="$each" ;; esac; done; cp -R "$src" "$last"');
  script(join(bin, "codesign"), "exit 0");
  script(join(bin, "chown"), "exit 0");
  const home = join(root, "home");
  const env = { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: home, EXTYNT_SUDO: "env", EXTYNT_APPLICATIONS_DIR: applications, EXTYNT_SYSTEM_SUPPORT_DIR: join(root, "system"), EXTYNT_ROOT_HOST_DIR: library, EXTYNT_INSTALL_CONTEXT: "pkg" };
  mkdirSync(home, { recursive: true });
  return { bundle, env, applications, library, calls };
}

test("install.sh --system-only installs the host library and the plugin into each supported After Effects, and nothing per user", (t) => {
  const setup = installRig(t);
  for (const year of ["2025", "2026", "2024"]) mkdirSync(join(setup.applications, `Adobe After Effects ${year}`, `Adobe After Effects ${year}.app`), { recursive: true });
  const result = run([join(setup.bundle, "install.sh"), "--system-only"], setup.env);
  assert.equal(result.status, 0, result.output);
  assert.equal(existsSync(join(setup.library, "probe.jsx")), true);
  for (const year of ["2025", "2026"]) assert.equal(existsSync(join(setup.applications, `Adobe After Effects ${year}`, "Plug-ins", "extynt", "extyntcore.plugin", "Contents")), true, year);
  assert.equal(existsSync(join(setup.applications, "Adobe After Effects 2024", "Plug-ins")), false);
  assert.equal(existsSync(setup.calls), false);
  assert.equal(result.output.includes("Administrator access is needed"), false);
});

test("install.sh --system-only fails without a supported After Effects, and --user-only installs only the sidecar", (t) => {
  const setup = installRig(t);
  const system = run([join(setup.bundle, "install.sh"), "--system-only"], setup.env);
  assert.notEqual(system.status, 0);
  assert.ok(system.output.includes("No supported After Effects"), system.output);
  const user = run([join(setup.bundle, "install.sh"), "--user-only"], setup.env);
  assert.equal(user.status, 0, user.output);
  assert.equal(readFileSync(setup.calls, "utf8").trim(), "install-sidecar");
});

test("uninstall.sh run through the /Library symlink still finds and runs the per-user half in the payload", (t) => {
  const root = tempDir(t, "uninstall"), systemRoot = join(root, "Library", "Application Support"), payload = join(systemRoot, "extynt", "installer", "9.9.9");
  const marker = join(root, "user-half-ran");
  mkdirSync(payload, { recursive: true });
  writeFileSync(join(payload, "uninstall.sh"), readFileSync("packaging/macos/uninstall.sh", "utf8"), { mode: 0o755 });
  script(join(payload, "sidecar-launchd", "uninstall-sidecar.sh"), `touch '${marker}'`);
  spawnSync("ln", ["-s", join(payload, "uninstall.sh"), join(systemRoot, "extynt", "uninstall.sh")]);
  const bin = join(root, "bin");
  script(join(bin, "uname"), "echo Darwin");
  const env = { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: join(root, "home"), EXTYNT_SUDO: "env", EXTYNT_SYSTEM_SUPPORT_DIR: systemRoot, EXTYNT_ROOT_HOST_DIR: join(systemRoot, "extynt", "host"), EXTYNT_APPLICATIONS_DIR: join(root, "Applications") };
  const result = run([join(systemRoot, "extynt", "uninstall.sh")], env);
  assert.equal(result.status, 0, result.output);
  assert.equal(existsSync(marker), true, result.output);
});

function noticeBundle(t: test.TestContext): string {
  const bundle = tempDir(t, "notice-bundle");
  mkdirSync(join(bundle, "licenses"), { recursive: true });
  for (const file of ["NOTICE", "licenses/xxhash-LICENSE.txt", "licenses/node-LICENSE.txt"]) writeFileSync(join(bundle, file), "text");
  return bundle;
}

function verifyNotices(bundle: string): Outcome {
  return run(["-c", `source "${MAKE_RELEASE}"; verify_notices "${bundle}"`], {});
}

test("make-release accepts a bundle with the third-party notices and refuses one without them", (t) => {
  assert.equal(verifyNotices(noticeBundle(t)).status, 0);
  const noNotice = noticeBundle(t);
  rmSync(join(noNotice, "licenses", "xxhash-LICENSE.txt"));
  assert.ok(verifyNotices(noNotice).output.includes("lacks NOTICE or its licenses"));
});

test("the Mac bundle script stages the third-party licenses", () => {
  assert.match(readFileSync("scripts/build-mac-bundle.sh", "utf8"), /node scripts\/stage-third-party-licenses\.ts/);
});

test("the staged NOTICE and licenses/ of a Mac bundle hold every path NOTICE references", (t) => {
  const bundle = tempDir(t, "licenses");
  const nodeLicense = join(bundle, "node-license");
  writeFileSync(nodeLicense, "node license");
  const result = spawnSync("node", ["scripts/stage-third-party-licenses.ts", "--bundle", bundle, "--node-license", nodeLicense], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const referenced = [...readFileSync(join(bundle, "NOTICE"), "utf8").matchAll(/\blicenses\/[A-Za-z0-9._-]+/g)].map((match) => match[0]);
  assert.ok(referenced.length >= 3, "NOTICE names the xxHash, AEQuery and Node.js texts");
  for (const path of referenced) assert.equal(existsSync(join(bundle, path)), true, path);
  assert.match(readFileSync(join(bundle, "licenses", "xxhash-LICENSE.txt"), "utf8"), /BSD 2-Clause/);
  const missing = spawnSync("node", ["scripts/stage-third-party-licenses.ts", "--bundle", bundle, "--node-license", join(bundle, "absent")], { encoding: "utf8" });
  assert.notEqual(missing.status, 0);
});

