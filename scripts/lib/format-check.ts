// clang-format enforcement for every C++ / Objective-C++ file we own, using the checked-in native/extynt-core/.clang-format.
import { join } from "node:path";
import { missingToolMessage, requireTools, runTool } from "./tools.ts";

const STYLE_FILE = "native/extynt-core/.clang-format";

interface FormatRequest {
  readonly root: string;
  readonly files: readonly string[];
}

/** Returns clang-format's findings (empty when every file is formatted). */
export function formatFailures({ root, files }: FormatRequest): string[] {
  const clangFormat = requireTools(["clang-format"]).get("clang-format");
  if (!clangFormat) throw new Error(missingToolMessage(["clang-format"]));
  const result = runTool(clangFormat, ["--dry-run", "-Werror", `--style=file:${join(root, STYLE_FILE)}`, ...files], { cwd: root });
  if (result.ok) return [];
  return result.output.split("\n").filter((line) => /error:/.test(line)).map((line) => line.replace(`${root}/`, ""));
}
