// Locates the extynt MCP server and runs it in this process. A plugin host may copy the plugin into its own cache, so a
// path relative to the repo is only one candidate: an explicit EXTYNT_MCP_SERVER wins, then a repo checkout, then the
// sidecar the installer puts in the per-user profile. The shell launcher next to it runs this file with a Node.js that
// strips types (the installer's runtime, or the one on the PATH).
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const SERVER_ENTRY = ["packages", "mcp-server", "dist", "src", "stdio.js"];

function profileDirectory(): string {
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "extynt");
  if (platform() === "win32") return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "extynt");
  return join(homedir(), ".config", "extynt");
}

function serverCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const explicit = process.env.EXTYNT_MCP_SERVER;
  return [
    ...(explicit ? [explicit] : []),
    join(here, "..", "..", ...SERVER_ENTRY),
    join(profileDirectory(), "sidecar", ...SERVER_ENTRY),
  ];
}

function exitServerNotFound(candidates: ReadonlyArray<string>): never {
  const looked = candidates.map((candidate) => `  ${candidate}`).join("\n");
  process.stderr.write(
    `extynt MCP server not found. Install extynt (packaging/macos/install.sh or packaging/windows/install.ps1) or set EXTYNT_MCP_SERVER. Looked in:\n${looked}\n`,
  );
  return process.exit(1);
}

function startServer(): void {
  const candidates = serverCandidates();
  const server = candidates.find((candidate) => existsSync(candidate));
  if (!server) exitServerNotFound(candidates);
  createRequire(import.meta.url)(server);
}

try {
  startServer();
} catch (error) {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`extynt-mcp failed to start: ${text}\n`);
  process.exit(1);
}
