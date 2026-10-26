/** Generates the ExtendScript runner and question probe from their templates and the case list. */
import { isJsonArray } from "@extynt/decode";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { MCP_SERVER_VERSION } from "@extynt/mcp-server";
import { allCases, type CaseWithMeta } from "./cases/index.js";
import { fixtureFiles } from "./files.js";
import { decodedValue, isJsonObject, jsonObjectOfDocument, type JsonObject } from "./json.js";
import { planCase, type PlannedStep } from "./plan.js";

const templateUrl = (name: string): URL => new URL(`../../runner/${name}`, import.meta.url);
/** Inlined in this order: later files read the namespace the earlier ones fill in. */
export const QUESTIONS_TEMPLATES = ["questions-support.jsx", "questions-parent-keys.jsx", "questions-shape-color.jsx", "questions.jsx"].map(templateUrl);
export const RUNNER_TEMPLATES = ["runner-values.jsx", "runner-dump.jsx", "runner-fixture.jsx", "runner-host.jsx", "runner-report.jsx", "runner-case.jsx", "runner.jsx"].map(templateUrl);
const HOST_DIRECTORY = new URL("../../../../apps/panel/host/", import.meta.url);
const HOST_LOAD_STATEMENT = /\$\.evalFile\(new File\(aeHostDirectory \+ "\/([A-Za-z0-9._-]+\.jsx)"\)\)/g;
const HOST_SIBLING_ENTRIES = new Set(["collection.jsx", "catalogue.jsx"]);

export interface PackCase { id: string; fixture: CaseWithMeta["fixture"]; steps: JsonObject[]; rerun: boolean; undo: boolean; external: boolean; plannerOnly: boolean; files: string[] }
export interface GenerationIssue { id: string; problem: string }
export interface Pack { kit: { generatedAt: string; packDigest: string; extyntVersion: string }; cases: PackCase[]; files: Record<string, number[]> }

/** A case's planned steps agree with its declared outcome; anything else is a broken case, not a host finding. */
export function planningIssue(liveCase: CaseWithMeta, planned: PlannedStep[]): string | undefined {
  const outcome = liveCase.outcome ?? { kind: "applied" };
  const rejected = planned.find((step) => step.kind === "planner-rejected");
  if (outcome.kind === "planner") {
    if (!rejected) return `expected planner code ${outcome.code}, but every step planned`;
    return rejected.code === outcome.code ? undefined : `expected planner code ${outcome.code}, got ${rejected.code}: ${rejected.message}`;
  }
  return rejected ? `planner refused a step that must reach After Effects: ${rejected.code}: ${rejected.message}` : undefined;
}

const commandOf = (step: PlannedStep): JsonObject => (step.kind === "plan" || step.kind === "raw" ? decodedValue(jsonObjectOfDocument(step.command)) : {});

type CommandPatch = NonNullable<CaseWithMeta["commandPatches"]>[number];

function patchedCommand(command: JsonObject, patch: CommandPatch): JsonObject {
  const operations = command.operations;
  if (!isJsonArray(operations)) return command;
  return {
    ...command,
    operations: operations.map((operation, index) => (index === patch.operation && isJsonObject(operation) ? { ...operation, ...patch.set } : operation)),
  };
}

function patchedCommands(commands: JsonObject[], patches: CommandPatch[]): JsonObject[] {
  return patches.reduce((current, patch) => current.map((command, step) => (step === patch.step ? patchedCommand(command, patch) : command)), commands);
}

type PackFlags = Pick<PackCase, "rerun" | "undo" | "external" | "plannerOnly">;
function packFlags(liveCase: CaseWithMeta, plannerOnly: boolean, issue: string | undefined): PackFlags {
  return {
    rerun: !plannerOnly && liveCase.rerun !== false,
    undo: !plannerOnly && liveCase.undo !== false,
    external: liveCase.external === true,
    plannerOnly: plannerOnly || !!issue,
  };
}

interface PackedCase { packCase: PackCase; steps: PlannedStep[]; issue?: string | undefined }
function packCase(liveCase: CaseWithMeta): PackedCase {
  const steps = planCase(liveCase);
  const issue = planningIssue(liveCase, steps);
  const plannerOnly = liveCase.outcome?.kind === "planner" || liveCase.outcome?.kind === "dialog";
  const commands = patchedCommands(plannerOnly || issue ? [] : steps.map(commandOf), liveCase.commandPatches ?? []);
  return {
    steps,
    issue,
    packCase: { id: liveCase.id, fixture: liveCase.fixture, steps: commands, ...packFlags(liveCase, plannerOnly, issue), files: liveCase.files ?? [] },
  };
}

export function buildPack(options: { effectSweep?: boolean | undefined; only?: ((id: string) => boolean) | undefined; now?: string | undefined } = {}): {
  pack: Pack;
  issues: GenerationIssue[];
  planned: Map<string, PlannedStep[]>;
} {
  const issues: GenerationIssue[] = [],
    planned = new Map<string, PlannedStep[]>(),
    cases: PackCase[] = [];
  for (const liveCase of allCases({ effectSweep: options.effectSweep }).filter((entry) => !options.only || options.only(entry.id))) {
    const built = packCase(liveCase);
    planned.set(liveCase.id, built.steps);
    if (built.issue) issues.push({ id: liveCase.id, problem: built.issue });
    cases.push(built.packCase);
  }
  const files = fixtureFiles();
  const body = JSON.stringify({ cases, files });
  const packDigest = createHash("sha256").update(body).digest("hex");
  return {
    pack: { kit: { generatedAt: options.now ?? new Date().toISOString(), packDigest, extyntVersion: MCP_SERVER_VERSION }, cases, files },
    issues,
    planned,
  };
}

/** The templates' text, joined in order. */
export function readTemplates(urls: URL[]): string {
  return urls.map((url) => readFileSync(url, "utf8")).join("\n");
}

function hostAdapterSource(): string {
  const entry = readFileSync(new URL("probe.jsx", HOST_DIRECTORY), "utf8");
  const names = [...entry.matchAll(HOST_LOAD_STATEMENT)].map((match) => match[1] ?? "").filter((name) => name !== "" && !HOST_SIBLING_ENTRIES.has(name));
  return names.map((name) => readFileSync(new URL(name, HOST_DIRECTORY), "utf8")).join("\n");
}

const INSTALLED_HOST_DIRECTORY = [
  "// ---- installed host library folder (files the adapter reads beside probe.jsx) ----",
  "var aeHostDirectory = (function () {",
  "    var root = $.os.indexOf(\"Windows\") === 0 ? $.getenv(\"PROGRAMDATA\") : \"/Library/Application Support\";",
  "    var folder = root ? new Folder(root + \"/extynt/host\") : null;",
  "    return folder && new File(folder.fsName + \"/manifest.json\").exists ? folder.fsName : undefined;",
  "}());",
].join("\n");

/** The single file a user runs in After Effects: case pack, production host adapter, open-questions probe, runner. */
export function renderRunner(pack: Pack): string {
  const adapter = hostAdapterSource(), runner = readTemplates(RUNNER_TEMPLATES), questions = readTemplates(QUESTIONS_TEMPLATES);
  return [
    `// extynt live verification ${pack.kit.extyntVersion} — generated ${pack.kit.generatedAt}, pack ${pack.kit.packDigest.slice(0, 16)}.`,
    "// Run from After Effects: File > Scripts > Run Script File. Test-only; never loaded by the panel.",
    "// VERIFY runs every case, DUMP writes a read-only project dump, PROBE answers the open host questions.",
    "// ---- JSON polyfill (apps/panel/host/json.jsx; a no-op where the engine has JSON, e.g. not After Effects 25) ----",
    readFileSync(new URL("json.jsx", HOST_DIRECTORY), "utf8"),
    `var EXTYNT_LIVE_PACK = ${JSON.stringify(pack)};`,
    "// ---- production host adapter (the parts apps/panel/host/probe.jsx loads) ----",
    adapter,
    INSTALLED_HOST_DIRECTORY,
    "// ---- open-questions probe (tools/host-verification/runner/questions*.jsx) ----",
    questions,
    "// ---- runner (tools/host-verification/runner/runner*.jsx) ----",
    runner,
  ].join("\n");
}
