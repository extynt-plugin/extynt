// The clang-tidy configuration for the Windows sources, which run on Linux against mingw's headers: the given base
// configuration (main or wrapper) with the two checks that mis-fire against mingw-w64 off.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TidyConfigPaths } from "./native-darwin.ts";
import { wrapperTidyConfig } from "./native-wrapper-tidy.ts";

interface WindowsTidyConfigFiles {
  readonly main: string;
  readonly wrapper: string;
}

const CHECKS_END = /\nWarningsAsErrors:/;
const OFF_CHECKS = Object.freeze(["readability-duplicate-include", "misc-include-cleaner"]);

/**
 * The configuration text for the Windows pass, derived from a main or wrapper configuration text. Two checks are off: clang-tidy 22
 * against mingw-w64 flags every include after <iterator> or <string> as a duplicate and asks for the private sub-headers that
 * windows.h only re-exports, so missing or unused includes in the Windows files are not tidy-checked (the architecture stage catches duplicates).
 */
export function windowsTidyConfig(text: string): string {
  if (!CHECKS_END.test(text)) throw new Error("native/extynt-core/.clang-tidy has no WarningsAsErrors line after its Checks");
  return text.replace(CHECKS_END, `,\n${OFF_CHECKS.map((name) => `  -${name}`).join(",\n")}\nWarningsAsErrors:`);
}

/** Writes the Windows configurations (main and wrapper) next to the logs and returns their paths. */
export function windowsTidyConfigFiles({ source, outDirectory }: TidyConfigPaths): WindowsTidyConfigFiles {
  mkdirSync(outDirectory, { recursive: true });
  const base = readFileSync(join(source, ".clang-tidy"), "utf8");
  const files = { main: join(outDirectory, "clang-tidy-windows.yaml"), wrapper: join(outDirectory, "clang-tidy-windows-wrapper.yaml") };
  writeFileSync(files.main, windowsTidyConfig(base));
  writeFileSync(files.wrapper, windowsTidyConfig(wrapperTidyConfig(base)));
  return files;
}
