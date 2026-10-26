#!/usr/bin/env node
/**
 * Decision evaluation: puts every labelled fixture to the decision models the environment configures, fits routing bands, prints a per-decision table and,
 * with `--out <path>`, writes the full results as JSON.
 * Flags: `--decision <name>` limits to one suite, `--timeout-ms <n>` sets how long a model request gets (default 4000),
 * `--skip-scale` leaves out the tournament suites, `--skip-specs` leaves out the spec suites,
 * `--shipped` scores the labelled set under the shipped bands instead of refitting them,
 * `--stress` adds the dropped-candidate stress suites, where the wanted candidate is removed and the right answer is none,
 * `--heldout` runs the held-out cases of the animation and orchestration decisions and the font descriptions under the shipped bands instead of refitting them.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { argv } from "node:process";
import { parseArgs } from "node:util";
import { DEFAULT_DECISION_TIMEOUT_MS, decisionModelsFromEnvironment } from "@extynt/decide";
import { shippedBands } from "./decision-heldout.js";
import { fitBands, score } from "./decision-eval-routing.js";
import { renderReport, reportJson } from "./decision-eval-report.js";
import type { ResolveResult, SpecResult } from "./decision-eval-report.js";
import { runResolveSuite, runSpecSuite } from "./decision-eval-run.js";
import { allResolveSuites, allSpecSuites } from "./decision-suites.js";
import { stressSuites } from "./decision-suites-stress.js";

const { values } = parseArgs({
  args: argv.slice(2),
  options: { out: { type: "string" }, decision: { type: "string" }, "timeout-ms": { type: "string" }, "skip-scale": { type: "boolean" }, "skip-specs": { type: "boolean" }, heldout: { type: "boolean" }, shipped: { type: "boolean" }, stress: { type: "boolean" } },
});

const options = { models: decisionModelsFromEnvironment(), decisionTimeoutMs: Number(values["timeout-ms"] ?? DEFAULT_DECISION_TIMEOUT_MS) };
const set = values.heldout === true ? "heldout" : "fit";
const wanted = (name: string): boolean => values.decision === undefined || values.decision === name;
const specs: SpecResult[] = [];
for (const suite of values["skip-specs"] === true ? [] : [...allSpecSuites(set), ...(values.stress === true ? stressSuites() : [])].filter((candidate) => wanted(candidate.name))) {
  const runs = await runSpecSuite(suite, options);
  specs.push({ suite, runs, fit: options.models.length === 0 ? null : values.shipped === true || set === "heldout" ? score(runs, shippedBands(suite.name)) : fitBands(runs) });
}
const resolves: ResolveResult[] = [];
for (const suite of values["skip-scale"] === true ? [] : allResolveSuites(set).filter((candidate) => wanted(candidate.name))) {
  resolves.push({ suite, outcomes: await runResolveSuite(suite, options) });
}

process.stdout.write(`decision models: ${options.models.length === 0 ? "none (offline only)" : options.models.map((model) => model.id).join(", ")}\n\n${renderReport(specs, resolves)}\n`);
if (values.out !== undefined) {
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, reportJson(specs, resolves, new Date().toISOString()));
}
