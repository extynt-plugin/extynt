// Prints the path of a derived clang-tidy configuration, writing it under .check-logs: `wrapper` (default) for the sdk_* files,
// `windows` and `windows-wrapper` for the Windows pass of check-ae-syntax-win.sh. The syntax-check scripts call it when no
// EXTYNT_TIDY_*_CONFIG is given, so a by-hand run reads what the gate stage does.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { windowsTidyConfigFiles } from "./lib/native-windows-tidy.ts";
import { wrapperTidyConfigFile } from "./lib/native-wrapper-tidy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "native", "extynt-core");
const outDirectory = join(root, ".check-logs");
const kind = process.argv[2] ?? "wrapper";
const windows = kind.startsWith("windows") ? windowsTidyConfigFiles({ source, outDirectory }) : undefined;
const path = windows ? windows[kind === "windows" ? "main" : "wrapper"] : wrapperTidyConfigFile({ source, outDirectory });
process.stdout.write(`${path}\n`);
