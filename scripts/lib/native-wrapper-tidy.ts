// The clang-tidy configuration for platform wrapper files (sdk_*.{h,cpp,mm}): the main configuration with the cast, union,
// vararg and integer-to-pointer checks off, and the header filter narrowed to the wrapper headers, which the main
// configuration leaves out. Every other check still applies to them.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { darwinTidyConfig } from "./native-darwin.ts";
import type { TidyConfigPaths } from "./native-darwin.ts";

// The one definition of a platform wrapper file: sdk_* under native/extynt-core/{ae,transport,catalogue-window}, relative or absolute.
// core/, tests/ and every other directory have no wrappers, so an sdk_ name there is an ordinary file under every rule.
export const SDK_WRAPPER_FILE = /(?:^|\/)native\/extynt-core\/(?:ae|transport|catalogue-window)\/sdk_[^/]+\.(?:cpp|h|mm)$/;
const WRAPPER_HEADER_FILTER = ".*/native/extynt-core/(ae|transport|catalogue-window)/sdk_[^/]*\\.h";

interface WrapperConfigRequest extends TidyConfigPaths {
  readonly platform?: NodeJS.Platform;
}

const RELAXED_CHECKS = ["reinterpret-cast", "const-cast", "cstyle-cast", "union-access", "vararg"];
const RELAXED_OTHER = ["performance-no-int-to-ptr"];
const HEADER_FILTER = /^HeaderFilterRegex:.*$/m;

/** The configuration text for wrapper files, derived from the main configuration text. */
export function wrapperTidyConfig(text: string): string {
  let relaxed = text;
  for (const name of RELAXED_CHECKS) {
    const line = new RegExp(`^(\\s*)(cppcoreguidelines-pro-type-${name})(,?)$`, "m");
    if (!line.test(relaxed)) throw new Error(`native/extynt-core/.clang-tidy does not list cppcoreguidelines-pro-type-${name}`);
    relaxed = relaxed.replace(line, "$1-$2$3");
  }
  for (const name of RELAXED_OTHER) relaxed = relaxed.replace(/^(\s*)(-cppcoreguidelines-pro-type-reinterpret-cast)/m, `$1-${name},\n$1$2`);
  if (!HEADER_FILTER.test(relaxed)) throw new Error("native/extynt-core/.clang-tidy has no HeaderFilterRegex");
  return relaxed.replace(HEADER_FILTER, `HeaderFilterRegex: '${WRAPPER_HEADER_FILTER}'`);
}

/** Writes the wrapper configuration next to the logs (with the Apple mapping on macOS) and returns its path. */
export function wrapperTidyConfigFile({ source, outDirectory, platform = process.platform }: WrapperConfigRequest): string {
  mkdirSync(outDirectory, { recursive: true });
  const base = readFileSync(join(source, ".clang-tidy"), "utf8");
  const file = join(outDirectory, "clang-tidy-wrapper.yaml");
  writeFileSync(file, wrapperTidyConfig(platform === "darwin" ? darwinTidyConfig(base) : base));
  return file;
}
