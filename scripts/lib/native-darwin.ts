// macOS-only setup for the native-core clang-tidy runs; on any other platform every function here leaves the run untouched.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runTool } from "./tools.ts";

/** The two directories every derived clang-tidy configuration is read from and written to. */
export interface TidyConfigPaths {
  readonly source: string;
  readonly outDirectory: string;
}

interface DarwinConfigRequest extends TidyConfigPaths {
  readonly platform?: NodeJS.Platform;
}

interface TidyEnvironmentRequest {
  readonly env: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly run?: typeof runTool;
}

// Apple's SDK defines POSIX types and functions in private sub-headers and the umbrella headers only re-export them, so
// misc-include-cleaner names a header nobody includes (or calls the umbrella unused).  These headers are ignored as the
// provider of a symbol; Linux keeps its own list in .clang-tidy.
export const DARWIN_IGNORED_HEADERS = Object.freeze([
  "sys/_types/.*",
  "sys/_endian\\.h", "(arm|i386|machine)/endian\\.h", "libkern/_OSByteOrder\\.h",
  "sys/fcntl\\.h",
  "sys/signal\\.h", "pthread\\.h",
  "sys/types\\.h",
  "MacTypes\\.h", "SPTypes\\.h",
  "CFBase\\.h", "mach/boolean\\.h",
]);

const IGNORE_LINE = /^(\s*misc-include-cleaner\.IgnoreHeaders:\s*')([^']*)'/m;

/** The clang-tidy configuration text with the Apple header mapping appended to the include-cleaner ignore list. */
export function darwinTidyConfig(text: string): string {
  if (!IGNORE_LINE.test(text)) throw new Error("native/extynt-core/.clang-tidy has no misc-include-cleaner.IgnoreHeaders option to extend");
  return text.replace(IGNORE_LINE, (_line: string, head: string, list: string) => `${head}${[list, ...DARWIN_IGNORED_HEADERS].join(";")}'`);
}

/** SDKROOT for the pinned pip clang-tidy, which does not find the SDK's libc++ headers by itself. */
export function tidyEnvironment({ env, platform = process.platform, run = runTool }: TidyEnvironmentRequest): NodeJS.ProcessEnv {
  if (platform !== "darwin" || env.SDKROOT) return env;
  const sdk = run("xcrun", ["--show-sdk-path"]);
  const path = sdk.output.trim();
  if (!sdk.ok || !path) throw new Error("clang-tidy on macOS needs the SDK path: SDKROOT is unset and `xcrun --show-sdk-path` failed. Install Xcode or the Command Line Tools, or set SDKROOT.");
  return { ...env, SDKROOT: path };
}

/** Writes the macOS configuration next to the logs and returns its path; undefined elsewhere, so Linux uses .clang-tidy as is. */
export function darwinTidyConfigFile({ source, outDirectory, platform = process.platform }: DarwinConfigRequest): string | undefined {
  if (platform !== "darwin") return undefined;
  mkdirSync(outDirectory, { recursive: true });
  const file = join(outDirectory, "clang-tidy-darwin.yaml");
  writeFileSync(file, darwinTidyConfig(readFileSync(join(source, ".clang-tidy"), "utf8")));
  return file;
}
