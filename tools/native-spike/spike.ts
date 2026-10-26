#!/usr/bin/env node
// extynt native plugin spike CLI: bench, compare and dump. Run with --help for usage.
import { main } from "./lib/cli.ts";

process.exitCode = await main(process.argv.slice(2));
