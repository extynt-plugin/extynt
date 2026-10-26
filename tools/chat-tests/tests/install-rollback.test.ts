/** Tests that a failed Mac sidecar upgrade restores code, UI, runtime, launcher and plist. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

interface Layout { home: string; bundle: string; install: string; commands: string; plist: string }

function layoutOf(root: string): Layout {
  const home = join(root, "home");
  const install = join(home, "Library", "Application Support", "extynt");
  return { home, bundle: join(root, "bundle"), install, commands: join(root, "commands"), plist: join(home, "Library", "LaunchAgents", "com.extynt.sidecar.plist") };
}

function writeBundle({ bundle }: Layout): void {
  mkdirSync(join(bundle, "sidecar-launchd"), { recursive: true });
  for (const name of ["sidecar", "runtime", "ui", "licenses"]) mkdirSync(join(bundle, name));
  writeFileSync(join(bundle, "NOTICE"), "notice");
  copyFileSync("packaging/macos/sidecar-launchd/install-sidecar.sh", join(bundle, "sidecar-launchd", "install-sidecar.sh"));
  writeFileSync(join(bundle, "sidecar", "new.txt"), "new sidecar");
  for (const name of ["index.html", "main.js", "ui-manifest.json"]) writeFileSync(join(bundle, "ui", name), "new ui");
  writeFileSync(join(bundle, "runtime", "node-runtime.env"), "NODE_VERSION=99.0.0\nNODE_SHA256_DARWIN_X64=pinnedhash\n");
  writeFileSync(join(bundle, "runtime", "node-v99.0.0-darwin-x64.tar.xz"), "fixture");
  writeFileSync(join(bundle, "sidecar-launchd", "com.extynt.sidecar.plist.template"), "new plist");
}

function writeInstall({ install, plist }: Layout): void {
  mkdirSync(join(install, "sidecar"), { recursive: true });
  mkdirSync(join(install, "ui"));
  mkdirSync(join(install, "runtime", "bin"), { recursive: true });
  mkdirSync(join(install, "bin"));
  mkdirSync(join(plist, ".."), { recursive: true });
  writeFileSync(join(install, "ui", "index.html"), "old ui");
  writeFileSync(join(install, "sidecar", "old.txt"), "old sidecar");
  writeExecutable(join(install, "runtime", "bin", "node"), "echo old-node");
  writeFileSync(join(install, "bin", "extynt-mcp"), "old launcher");
  writeFileSync(plist, "old plist");
}

function writeCommands({ commands }: Layout, failure: string): void {
  mkdirSync(commands);
  const untar = "while [ \"$1\" != '-C' ]; do shift; done; shift; mkdir -p \"$1/bin\"; printf '#!/bin/sh\\necho new-node\\n' > \"$1/bin/node\"; touch \"$1/LICENSE\"";
  writeExecutable(join(commands, "uname"), "echo Darwin");
  writeExecutable(join(commands, "sysctl"), "echo 0");
  writeExecutable(join(commands, "shasum"), "echo 'pinnedhash  fixture'");
  writeExecutable(join(commands, "tar"), failure === "tar" ? "exit 42" : untar);
  writeExecutable(join(commands, "launchctl"), failure === "bootstrap" ? "[ \"$1\" != bootstrap ]" : "exit 0");
}

function assertRestored({ install, plist }: Layout): void {
  assert.equal(readFileSync(join(install, "sidecar", "old.txt"), "utf8"), "old sidecar");
  assert.equal(readFileSync(join(install, "ui", "index.html"), "utf8"), "old ui");
  assert.equal(existsSync(join(install, "ui", "main.js")), false);
  assert.equal(readFileSync(join(install, "runtime", "bin", "node"), "utf8"), "#!/bin/sh\necho old-node\n");
  assert.equal(readFileSync(join(install, "bin", "extynt-mcp"), "utf8"), "old launcher");
  assert.equal(readFileSync(plist, "utf8"), "old plist");
  assert.equal(existsSync(join(install, "sidecar", "new.txt")), false);
}

test("a failed Mac sidecar upgrade restores its code, served UI, runtime, launcher, and plist", (t) => {
  for (const failure of ["tar", "bootstrap"]) {
    const root = mkdtempSync(join(tmpdir(), "extynt-install-rollback-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const layout = layoutOf(root);
    writeBundle(layout);
    writeInstall(layout);
    writeCommands(layout, failure);
    const env = { ...process.env, HOME: layout.home, PATH: `${layout.commands}:${process.env.PATH ?? ""}` };
    const result = spawnSync("bash", [join(layout.bundle, "sidecar-launchd", "install-sidecar.sh")], { env, encoding: "utf8" });
    assert.notEqual(result.status, 0, `${failure}: ${result.stdout}\n${result.stderr}`);
    assertRestored(layout);
  }
});
