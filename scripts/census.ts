#!/usr/bin/env node
// Prints the typing census (TypeScript escape hatches and unknown violations per area), the native census per C++ directory and the header-length report.
import { readFileSync } from "node:fs";
import type { SourceEntry } from "./lib/source-entry.ts";
import { NATIVE_CENSUS_FIELDS, TYPE_CENSUS_FIELDS, formatCensus, headerLengthReport, nativeCensus, typeCensus } from "./lib/census.ts";
import { maintainedFiles, nativeFiles, powershellFiles, rel, shellFiles } from "./lib/sources.ts";

const entriesOf = (files: ReadonlyArray<string>): SourceEntry[] => files.map((file) => ({ key: rel(file), text: readFileSync(file, "utf8") }));

console.log("TypeScript census (counts of what the gate forbids)");
console.log(formatCensus(typeCensus(entriesOf(maintainedFiles())), TYPE_CENSUS_FIELDS));
console.log("\nC++ census (native/extynt-core, third_party and stubs excluded)");
console.log(formatCensus(nativeCensus(entriesOf(nativeFiles())), NATIVE_CENSUS_FIELDS));

const header = headerLengthReport(entriesOf([...maintainedFiles(), ...nativeFiles(), ...shellFiles(), ...powershellFiles()]));
console.log("\nHeader-length report (files whose opening comment is over the cap)");
console.log(header.areas.map(([area, count]) => `${area}=${count}`).join(" ") || "none");
if (header.files.length > 0) console.log(header.files.join("\n"));
