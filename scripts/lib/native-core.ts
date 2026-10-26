// Gate stage for native/extynt-core: tool tests, Release and sanitizer builds with their tests, clang-tidy, and the AE syntax check.
// Every prerequisite is required: a missing tool fails the stage with the command that installs it; nothing is skipped silently.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, globSync, mkdirSync, readFileSync } from "node:fs";
import { cpus } from "node:os";
import { join, resolve } from "node:path";
import { testEnvironment } from "../run-tests.ts";
import { darwinTidyConfigFile, tidyEnvironment } from "./native-darwin.ts";
import { windowsTidyConfigFiles } from "./native-windows-tidy.ts";
import { SDK_WRAPPER_FILE, wrapperTidyConfigFile } from "./native-wrapper-tidy.ts";
import { mingwCompiler } from "./mingw-toolchain.ts";
import { missingToolMessage, requireTools, runTool } from "./tools.ts";
import { WEBVIEW2_INCLUDE, webview2Present } from "./webview2-package.ts";

interface StepResult {
  readonly ok: boolean;
  readonly output: string;
  readonly label: string;
}

interface NativeStageResult {
  readonly ok: boolean;
  readonly output: string;
  readonly summary?: string | undefined;
}

interface StepOptions {
  readonly env?: NodeJS.ProcessEnv;
}

type StepCommand = readonly [command: string, args: readonly string[], label: string];
type CoreStage = () => NativeStageResult | Promise<NativeStageResult>;

interface BuildRequest {
  readonly source: string;
  readonly build: string;
  readonly compiler: string | undefined;
  readonly flags: readonly string[];
  readonly name: string;
}

interface TidyRun {
  readonly tidy: string;
  readonly build: string;
  readonly file: string;
  readonly env: NodeJS.ProcessEnv;
  readonly config: string | undefined;
}

interface TidyCoreRequest {
  readonly source: string;
  readonly build: string;
  readonly tidy: string;
  readonly env: NodeJS.ProcessEnv;
  readonly config: string | undefined;
  readonly wrapperConfig: string;
}

interface CheckRequest {
  readonly source: string;
  readonly env: NodeJS.ProcessEnv;
  readonly logDir: string;
}

interface TidyStageRequest extends CheckRequest {
  readonly tidy: string;
}

interface NativeCoreRequest {
  readonly root: string;
  readonly logDir: string;
  readonly env?: NodeJS.ProcessEnv;
}

const SANITIZER_FLAGS = ["-DCMAKE_BUILD_TYPE=Debug", "-DEXTYNT_SANITIZE=ON"];
const TIDY_SOURCES = ["core", "transport", "tests"];

function available(command: string): boolean {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

function compilerName(preferred: readonly string[]): string | undefined {
  return preferred.find(available);
}

function step(command: string, args: readonly string[], label: string, options: StepOptions = {}): StepResult {
  const result = runTool(command, args, { timeout: 900_000, ...options });
  return { ok: result.ok, output: `$ ${command} ${args.join(" ")}\n${result.output}`, label };
}

function toolTests(root: string): StepResult {
  const files = globSync("tools/native-spike/tests/*.test.ts", { cwd: root });
  if (!files.length) return { ok: true, output: "no tools/native-spike tests", label: "tool-tests" };
  return step(process.execPath, ["--test", ...files], "tool-tests", { env: testEnvironment(process.env) });
}

function runSteps(steps: readonly StepCommand[]): NativeStageResult {
  let output = "";
  for (const [command, args, label] of steps) {
    const result = step(command, args, label);
    output += `${result.output}\n`;
    if (!result.ok) return { ok: false, output, summary: `${label} failed` };
  }
  return { ok: true, output };
}

function buildAndTest({ source, build, compiler, flags, name }: BuildRequest): NativeStageResult {
  mkdirSync(build, { recursive: true });
  const configure = ["-S", source, "-B", build, `-DCMAKE_CXX_COMPILER=${compiler}`, ...flags];
  return runSteps([
    ["cmake", configure, `${name} configure`],
    ["cmake", ["--build", build, "--parallel"], `${name} build`],
    ["ctest", ["--test-dir", build, "--output-on-failure"], `${name} ctest`],
  ]);
}

const WINDOWS_HEADER = /^\s*#\s*include\s*<(windows|winsock2|ws2tcpip|shlobj|bcrypt)\.h>/m;

function includesWindowsHeaders(file: string): boolean {
  return WINDOWS_HEADER.test(readFileSync(file, "utf8"));
}

function tidyTargets(source: string): string[] {
  const sources = TIDY_SOURCES.flatMap((directory) => globSync(`${directory}/*.cpp`, { cwd: source }));
  const lonelyHeaders = TIDY_SOURCES.flatMap((directory) => globSync(`${directory}/sdk_*.h`, { cwd: source })).filter((header) => !sources.includes(header.replace(/\.h$/, ".cpp")));
  return [...sources, ...lonelyHeaders].map((file) => join(source, file)).filter((file) => !includesWindowsHeaders(file)).sort();
}

function tidyOne({ tidy, build, file, env, config }: TidyRun): Promise<NativeStageResult> {
  return new Promise((resolveRun) => {
    const configArguments = config ? [`--config-file=${config}`] : [];
    const child = spawn(tidy, ["-p", build, "--quiet", ...configArguments, file], { env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("close", (code) => resolveRun({ ok: code === 0, output: Buffer.concat(chunks).toString("utf8") }));
  });
}

async function tidyCore({ source, build, tidy, env, config, wrapperConfig }: TidyCoreRequest): Promise<NativeStageResult> {
  const queue = tidyTargets(source);
  const failures: string[] = [];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const result = await tidyOne({ tidy, build, file, env, config: SDK_WRAPPER_FILE.test(file) ? wrapperConfig : config });
      if (!result.ok) failures.push(result.output);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, cpus().length) }, worker));
  return failures.length ? { ok: false, output: failures.join("\n"), summary: "clang-tidy findings" } : { ok: true, output: "clang-tidy clean\n" };
}

function aeCheck({ source, env, logDir }: CheckRequest): NativeStageResult {
  const script = join(source, "tests", "syntax-check", "check-ae-syntax.sh");
  if (!env.AE_SDK_ROOT) return { ok: true, output: "ae/ syntax and clang-tidy skipped: AE_SDK_ROOT is not set (the Mac and Windows builds cover ae/)\n", summary: "ae/ skipped (no AE_SDK_ROOT)" };
  const syntax = step("bash", [script], "ae syntax", { env });
  if (!syntax.ok) return { ...syntax, summary: "ae syntax check failed" };
  const tidyEnv = { ...tidyEnvironment({ env }), EXTYNT_TIDY: "1" };
  const config = darwinTidyConfigFile({ source, outDirectory: logDir });
  const wrapperConfig = wrapperTidyConfigFile({ source, outDirectory: logDir });
  const tidy = step("bash", [script], "ae clang-tidy", { env: { ...tidyEnv, ...(config ? { EXTYNT_TIDY_CONFIG: config } : {}), EXTYNT_TIDY_WRAPPER_CONFIG: wrapperConfig } });
  return { ok: tidy.ok, output: `${syntax.output}\n${tidy.output}`, summary: tidy.ok ? undefined : "ae clang-tidy findings" };
}

function windowsCheck({ source, env, logDir }: CheckRequest): NativeStageResult {
  if (!env.AE_SDK_ROOT) return { ok: true, output: "Windows syntax check and clang-tidy skipped: AE_SDK_ROOT is not set (the Windows build covers them)\n", summary: "windows skipped (no AE_SDK_ROOT)" };
  const cross = env.WIN_CXX || ["x86_64-w64-mingw32-g++-posix", "x86_64-w64-mingw32-g++"].find(available) || mingwCompiler();
  if (!cross) return { ok: false, output: "the Windows syntax check needs a mingw-w64 cross compiler: run pnpm setup:tools (pinned download, no root), or install g++-mingw-w64-x86-64, or set WIN_CXX.\n", summary: "mingw-w64 missing" };
  if (!webview2Present()) return { ok: false, output: "the Windows syntax check needs the WebView2 headers. Run: pnpm setup:tools\n", summary: "WebView2 headers missing" };
  const script = join(source, "tests", "syntax-check", "check-ae-syntax-win.sh");
  const windowsEnv = { ...env, WIN_CXX: cross, WEBVIEW2_INCLUDE };
  const syntax = step("bash", [script], "windows syntax", { env: windowsEnv });
  if (!syntax.ok) return { ...syntax, summary: "windows syntax check failed" };
  const configs = windowsTidyConfigFiles({ source, outDirectory: logDir });
  const tidyEnv = { ...tidyEnvironment({ env: windowsEnv }), EXTYNT_TIDY: "1", EXTYNT_TIDY_WINDOWS_CONFIG: configs.main, EXTYNT_TIDY_WINDOWS_WRAPPER_CONFIG: configs.wrapper };
  const tidy = step("bash", [script], "windows clang-tidy", { env: tidyEnv });
  return { ok: tidy.ok, output: `${syntax.output}\n${tidy.output}`, summary: tidy.ok ? undefined : "windows clang-tidy findings" };
}

function prerequisites(): string[] {
  const missing: string[] = [];
  if (!available("cmake")) missing.push("cmake");
  if (!compilerName(["c++", "g++", "clang++"])) missing.push("a C++ compiler");
  if (!available("ctest")) missing.push("ctest");
  return missing;
}

function sdkEnvironment(root: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return env.AE_SDK_ROOT ? { ...env, AE_SDK_ROOT: resolve(root, env.AE_SDK_ROOT) } : env;
}

/** A failure result when AE_SDK_ROOT is configured but names no existing directory, otherwise null (unset means the SDK checks are skipped). */
export function sdkRootFailure(env: NodeJS.ProcessEnv): NativeStageResult | null {
  if (!env.AE_SDK_ROOT || existsSync(env.AE_SDK_ROOT)) return null;
  return { ok: false, output: `AE_SDK_ROOT is set to ${env.AE_SDK_ROOT}, which does not exist; unset it to skip the ae/ and Windows checks`, summary: "AE_SDK_ROOT not found" };
}

function preflightFailure(source: string, env: NodeJS.ProcessEnv): NativeStageResult | null {
  const sdkMissing = sdkRootFailure(env);
  if (sdkMissing) return sdkMissing;
  if (!existsSync(join(source, "CMakeLists.txt"))) return { ok: false, output: "native/extynt-core/CMakeLists.txt is missing", summary: "native/extynt-core missing" };
  const missing = prerequisites();
  if (!missing.length) return null;
  return { ok: false, output: `native-core needs ${missing.join(", ")}: install cmake and a C++ compiler (gcc or clang); native/extynt-core is built on every check`, summary: "toolchain missing" };
}

function coreStages({ source, logDir, env }: CheckRequest): CoreStage[] {
  const compiler = compilerName(["c++", "g++", "clang++"]);
  const tidy = requireTools(["clang-tidy"]).get("clang-tidy");
  if (!tidy) throw new Error(missingToolMessage(["clang-tidy"]));
  return [
    () => buildAndTest({ source, build: join(logDir, "native-core-build"), compiler, flags: ["-DCMAKE_BUILD_TYPE=Release"], name: "release" }),
    () => buildAndTest({ source, build: join(logDir, "native-core-asan"), compiler, flags: SANITIZER_FLAGS, name: "sanitizer" }),
    () => tidyStage({ source, logDir, tidy, env }),
    () => aeCheck({ source, env, logDir }),
    () => windowsCheck({ source, env, logDir }),
  ];
}

async function runCoreStages(stages: readonly CoreStage[], first: string): Promise<NativeStageResult> {
  let output = `${first}\n`;
  const notes: string[] = [];
  let failed = "";
  for (const stage of stages) {
    const result = await stage();
    output += `${result.output}\n`;
    if (!result.ok) failed ||= result.summary ?? "failed";
    else if (result.summary) notes.push(result.summary);
  }
  if (failed) return { ok: false, output, summary: failed };
  return { ok: true, output, summary: notes.join("; ") || "tool tests, Release and sanitizer ctest, clang-tidy, ae syntax passed" };
}

/**
 * Runs the native-core stage and returns { ok, output, summary }. An unset AE_SDK_ROOT skips the ae/ and Windows checks
 * and says so; one that names a missing directory fails.
 */
export async function nativeCoreStage({ root, logDir, env: given = process.env }: NativeCoreRequest): Promise<NativeStageResult> {
  const env = sdkEnvironment(root, given);
  const tool = toolTests(root);
  if (!tool.ok) return { ok: false, output: tool.output, summary: "tools/native-spike tests failed" };
  const source = join(root, "native", "extynt-core");
  const missing = preflightFailure(source, env);
  return missing ?? runCoreStages(coreStages({ source, logDir, env }), tool.output);
}

async function tidyStage({ source, logDir, tidy, env }: TidyStageRequest): Promise<NativeStageResult> {
  const compiler = compilerName(["clang++", "c++", "g++"]);
  const build = join(logDir, "native-core-tidy");
  mkdirSync(build, { recursive: true });
  const configure = step("cmake", ["-S", source, "-B", build, `-DCMAKE_CXX_COMPILER=${compiler}`, "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON"], "tidy configure");
  if (!configure.ok) return { ...configure, summary: "tidy configure failed" };
  return tidyCore({
    source,
    build,
    tidy,
    env: tidyEnvironment({ env }),
    config: darwinTidyConfigFile({ source, outDirectory: logDir }),
    wrapperConfig: wrapperTidyConfigFile({ source, outDirectory: logDir }),
  });
}
