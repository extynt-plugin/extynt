// Entry point run by run-sidecar.cmd on Windows: node windows-supervisor-main.js <stop marker> <sidecar main.js>. It keeps the
// sidecar running, waits with timers rather than helper processes, and stops when the marker is newer than its own start.
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { superviseSidecar, type SupervisorPorts } from "./windows-supervisor.js";

function markerIsNewer(markerPath: string, sinceMs: number): boolean {
  try {
    return statSync(markerPath).mtimeMs >= sinceMs;
  } catch {
    return false;
  }
}

function runSidecar(mainPath: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--no-sparkplug", mainPath], { stdio: "inherit", windowsHide: true });
    child.once("error", (error) => {
      process.stderr.write(`extynt supervisor: could not start the sidecar: ${error.message}\n`);
      resolve(1);
    });
    child.once("close", (code) => resolve(code ?? 1));
  });
}

function portsFor(markerPath: string, mainPath: string): SupervisorPorts {
  const startedMs = Date.now();
  return {
    runSidecar: () => runSidecar(mainPath),
    nowMs: () => Date.now(),
    sleep: (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)),
    stopRequested: () => markerIsNewer(markerPath, startedMs),
    log: (line) => process.stderr.write(`${line}\n`),
  };
}

const [markerPath, mainPath = join(dirname(fileURLToPath(import.meta.url)), "main.js")] = process.argv.slice(2);
if (!markerPath) {
  process.stderr.write("usage: windows-supervisor-main.js <stop marker> [sidecar main.js]\n");
  process.exit(2);
}
process.exitCode = await superviseSidecar(portsFor(markerPath, mainPath));
