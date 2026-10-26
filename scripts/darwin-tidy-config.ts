// Prints the path of the macOS clang-tidy configuration (native/extynt-core/.clang-tidy plus the Apple header mapping),
// writing it under .check-logs. check-ae-syntax.sh calls it on macOS so a by-hand ae/ tidy run reads the same mapping
// the gate stage does; on any other platform it prints nothing.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { darwinTidyConfigFile } from "./lib/native-darwin.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = darwinTidyConfigFile({ source: join(root, "native", "extynt-core"), outDirectory: join(root, ".check-logs") });
if (file) process.stdout.write(`${file}\n`);
