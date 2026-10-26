// The macOS release script refuses a bundle that is not this checkout's version and architecture (make-release.sh), and
// the Mac bundle script's clean-tree check cannot misread a dirty tree under pipefail (build-mac-bundle.sh).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { ROOT } from "../scripts/lib/sources.ts";

const RELEASE = join(ROOT, "packaging", "macos", "release", "make-release.sh");

interface BundleTarget {
  readonly version: string;
  readonly target: "universal" | "arm64";
}

function fakeBundle(root: string, version: string, arches: readonly string[]) {
  const dir = join(root, "bundle");
  mkdirSync(join(dir, "sidecar", "apps", "sidecar"), { recursive: true });
  mkdirSync(join(dir, "runtime"), { recursive: true });
  writeFileSync(join(dir, "sidecar", "apps", "sidecar", "package.json"), JSON.stringify({ name: "extynt", version }, null, 2));
  for (const arch of arches) writeFileSync(join(dir, "runtime", `node-v24.1.0-darwin-${arch}.tar.xz`), "");
  return dir;
}

function verify(dir: string, { version, target }: BundleTarget) {
  const targets = {
    universal: { bundle_arches: "arm64 x64", arch_choice: "universal" },
    arm64: { bundle_arches: "arm64", arch_choice: "arm64" },
  };
  const script = [
    "set -euo pipefail",
    `source "${RELEASE}"`,
    `version="${version}"`,
    `bundle_arches="${targets[target].bundle_arches}"`,
    `arch_choice="${targets[target].arch_choice}"`,
    `verify_bundle_identity "${dir}"`,
  ].join("\n");
  return spawnSync("bash", ["-c", script], { encoding: "utf8" });
}

test("a bundle is accepted only for this checkout's version and the release architectures", () => {
  const root = mkdtempSync(join(tmpdir(), "make-release-bundle-"));
  try {
    const universal = fakeBundle(join(root, "u"), "0.9.8t", ["arm64", "x64"]);
    assert.equal(verify(universal, { version: "0.9.8t", target: "universal" }).status, 0);

    const stale = verify(fakeBundle(join(root, "stale"), "0.9.8e", ["arm64", "x64"]), { version: "0.9.8t", target: "universal" });
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /the bundle is version 0\.9\.8e .* this checkout is 0\.9\.8t/);

    const oneArch = verify(fakeBundle(join(root, "one"), "0.9.8t", ["arm64"]), { version: "0.9.8t", target: "universal" });
    assert.notEqual(oneArch.status, 0);
    assert.match(oneArch.stderr, /runtimes \[arm64\]/);

    const arm = verify(fakeBundle(join(root, "arm"), "0.9.8t", ["arm64"]), { version: "0.9.8t", target: "arm64" });
    assert.equal(arm.status, 0, arm.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Mac bundle's clean-tree check reads git status into a variable rather than piping it into grep -q", () => {
  const bundle = readFileSync(join(ROOT, "scripts", "build-mac-bundle.sh"), "utf8");
  assert.doesNotMatch(bundle, /git -C "\$\{repo_root\}" status --porcelain \| grep -q/);
  assert.match(bundle, /if \[ -n "\$\(git -C "\$\{repo_root\}" status --porcelain\)" \]; then/);
});

test("the Mac bundle stages the sidecar from an allowlist, not by copying the checkout", () => {
  const bundle = readFileSync(join(ROOT, "scripts", "build-mac-bundle.sh"), "utf8");
  assert.doesNotMatch(bundle, /cp -R "\$\{repo_root\}\/\."/);
  assert.match(bundle, /node scripts\/stage-sidecar\.ts --bundle "\$\{bundle_dir\}"/);
});

test("the staged sidecar holds only manifests and built sources, and starts", () => {
  const root = mkdtempSync(join(tmpdir(), "stage-sidecar-"));
  try {
    const result = spawnSync(process.execPath, [join(ROOT, "scripts", "stage-sidecar.ts"), "--bundle", root], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const entries = readdirSync(join(root, "sidecar"), { recursive: true, withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(join(root, "sidecar").length + 1).split(sep).join("/"));
    const stray = files.filter((file) => !/^(?:apps\/sidecar|node_modules\/@extynt\/[^/]+)\/(?:package\.json|dist\/src\/)/.test(file));
    assert.deepEqual(stray, []);
    assert.ok(files.includes("apps/sidecar/dist/src/main.js"));
    assert.ok(files.includes("node_modules/@extynt/mcp-server/dist/src/stdio.js"));
    assert.equal(files.some((file) => file.endsWith(".d.ts") || file.includes("/tests/")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
