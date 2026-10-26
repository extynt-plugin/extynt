// A pinned mingw-w64 cross compiler for the Windows syntax check, unpacked without root into
// ~/.cache/extynt/toolchains. The packages are Ubuntu's own (pool.universe); every .deb is verified by SHA-256 before
// dpkg-deb unpacks it. A system compiler on PATH or WIN_CXX takes precedence (see native-core.ts).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const POOL = "https://archive.ubuntu.com/ubuntu/pool/universe";
const TOOLCHAIN_VERSION = "13.2.0-6ubuntu1+26.1";

type MingwPackage = readonly [pool: string, file: string, sha256: string];

export const MINGW_PACKAGES: ReadonlyArray<MingwPackage> = Object.freeze<ReadonlyArray<MingwPackage>>([
  ["b/binutils-mingw-w64", "binutils-mingw-w64-x86-64_2.45.90.20260125-1ubuntu1+13.3_amd64.deb", "f835050ed5b7fedf8f3242610fda1eb55b5472b72624f9a88de90c610b465552"],
  ["g/gcc-mingw-w64", `gcc-mingw-w64-base_${TOOLCHAIN_VERSION}_amd64.deb`, "a30c07e807e9874ea93909448c5d6d37f9569ebe60ad32de8e490aad198538a3"],
  ["g/gcc-mingw-w64", `gcc-mingw-w64-x86-64-posix-runtime_${TOOLCHAIN_VERSION}_amd64.deb`, "aca6b438e0b55b11cedcf1170a1ee26e7979e34192e34f6e6389e560908a5bfc"],
  ["g/gcc-mingw-w64", `gcc-mingw-w64-x86-64-posix_${TOOLCHAIN_VERSION}_amd64.deb`, "0855fa1d4a618550faac3a3e4352aa3226833b28184ad3c3b496a68a22c4eda2"],
  ["g/gcc-mingw-w64", `g++-mingw-w64-x86-64-posix_${TOOLCHAIN_VERSION}_amd64.deb`, "52c3613f386e462ae71105d1a0b2a48d866ccb048ad253acff629c5a2291252d"],
  ["m/mingw-w64", "mingw-w64-common_13.0.0-2ubuntu1_all.deb", "da9b2cb14134ca0ef3a31302df50295a2dd6fee7aa4fd888b11c6f72f8ab939e"],
  ["m/mingw-w64", "mingw-w64-x86-64-dev_13.0.0-2ubuntu1_all.deb", "da40b9e2ae89d98d44b547a9e4fd01862858edb176bade9f12ad143e7ae7efe4"],
]);

export function mingwRoot(home = homedir()): string {
  return join(home, ".cache", "extynt", "toolchains", `mingw-${TOOLCHAIN_VERSION}`);
}

/** The compiler wrapper the gate runs as WIN_CXX, or undefined when setup has not unpacked the toolchain. */
export function mingwCompiler(home = homedir()): string | undefined {
  const wrapper = join(mingwRoot(home), "win-cxx");
  return existsSync(wrapper) ? wrapper : undefined;
}

// The packages are relocated from /usr, so the compiler is pointed at its headers and runtime explicitly.
export function wrapperScript(root: string): string {
  const prefix = join(root, "usr");
  return `#!/bin/sh\nexec "${prefix}/bin/x86_64-w64-mingw32-g++-posix" "$@" -idirafter "${prefix}/x86_64-w64-mingw32/include"\n`;
}

async function download([pool, file, sha256]: MingwPackage, target: string): Promise<void> {
  const response = await fetch(`${POOL}/${pool}/${file.replaceAll("+", "%2b")}`);
  if (!response.ok) throw new Error(`mingw download of ${file} failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== sha256) throw new Error(`mingw package ${file} hash mismatch: ${hash}`);
  writeFileSync(target, bytes);
}

function unpack(archive: string, root: string): void {
  const result = spawnSync("dpkg-deb", ["-x", archive, root], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`dpkg-deb -x ${archive} failed (dpkg-deb is required): ${result.stderr || result.error}`);
}

/** Downloads, verifies and unpacks the toolchain (Linux x64 with dpkg-deb); a no-op when present. */
export async function fetchMingw(home = homedir()): Promise<void> {
  if (mingwCompiler(home)) return;
  if (process.platform !== "linux" || process.arch !== "x64") {
    console.log("mingw-w64: no pinned toolchain for this platform; install mingw-w64 or set WIN_CXX to run the Windows syntax check");
    return;
  }
  const root = mingwRoot(home);
  const staging = `${root}.partial`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  for (const item of MINGW_PACKAGES) {
    const archive = join(staging, item[1]);
    await download(item, archive);
    unpack(archive, staging);
    rmSync(archive);
  }
  rmSync(root, { recursive: true, force: true });
  spawnSync("mv", [staging, root]);
  const wrapper = join(root, "win-cxx");
  writeFileSync(wrapper, wrapperScript(root));
  chmodSync(wrapper, 0o755);
  if (!readFileSync(wrapper, "utf8").includes(root)) throw new Error("mingw wrapper was not written");
}
