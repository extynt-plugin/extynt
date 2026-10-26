/** The bench command. */
import type { CliOptions } from "./args.ts";
import { formatBench } from "./bench-report.ts";
import { hasOpErrors, runBench } from "./bench-run.ts";
import type { CommandContext } from "./command-context.ts";
import { connectNative, publicDiscovery } from "./connect.ts";
import { psRunner, requirePid, runCpuSample } from "./cpu-sample.ts";
import type { CpuDeps } from "./cpu-sample.ts";
import { emit } from "./output.ts";
import { VERSION } from "./version.ts";

/** What the bench command needs from the command context, plus the CPU sampling effects a test can replace. */
export interface BenchContext extends Pick<CommandContext, "options" | "io"> {
  readonly deps?: CpuDeps;
}

function wantsBench(options: CliOptions): boolean {
  return !options.cpuSample || options.commandGiven;
}

function realDeps(): CpuDeps {
  return {
    runPs: psRunner(),
    sleep: (ms) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }),
    now: () => Date.now(),
  };
}

/** Runs the benchmark and/or the CPU sample, prints the result and returns the exit code (1 when an op errored). */
export async function benchCommand({ options, io, deps = realDeps() }: BenchContext): Promise<number> {
  const { client, discovery, discoveryPath } = await connectNative(options);
  try {
    if (options.cpuSample) requirePid(discovery.pid);
    const startedAt = new Date().toISOString();
    const bench = wantsBench(options) ? await runBench(client, options) : undefined;
    const cpu = options.cpuSample ? await runCpuSample({ options, pid: discovery.pid }, deps) : undefined;
    const result = { tool: "native-spike", version: VERSION, command: "bench", startedAt, discovery: publicDiscovery(discovery, discoveryPath), ...bench, cpu };
    emit({ options, io }, result, formatBench(bench, cpu));
    return hasOpErrors(bench) ? 1 : 0;
  } finally {
    client.close();
  }
}

