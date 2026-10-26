// Shell and PowerShell gates: pinned shellcheck at style severity, the script header rules, and the PowerShell limits.
import { readFileSync } from "node:fs";
import { powershellFileFailures } from "./ps1-rules.ts";
import { missingToolMessage, requireTools, runTool } from "./tools.ts";

const BASH_HEADER = "#!/usr/bin/env bash";
const POSIX_HEADER = "#!/bin/sh";
const STRICT_MODE: ReadonlyMap<string, string> = new Map([[BASH_HEADER, "set -euo pipefail"], [POSIX_HEADER, "set -eu"]]);

interface ShellRequest {
  readonly root: string;
  readonly shellFiles: readonly string[];
  readonly powershellFiles?: readonly string[];
}

function firstStatement(lines: readonly string[]): string | undefined {
  return lines.slice(1).find((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
}

/** Header rules for one script: an allowed shebang, then strict mode as the first statement. */
export function headerFailures(key: string, text: string): string[] {
  const lines = text.split(/\r?\n/);
  const strict = STRICT_MODE.get(lines[0] ?? "");
  if (!strict) return [`${key}:1: the first line must be ${BASH_HEADER} (or ${POSIX_HEADER} for a script that must be POSIX)`];
  if (firstStatement(lines)?.trim() !== strict) return [`${key}: the first statement must be \`${strict}\``];
  return [];
}

function shellcheckFailures(root: string, files: readonly string[]): string[] {
  if (files.length === 0) return [];
  const shellcheck = requireTools(["shellcheck"]).get("shellcheck");
  if (!shellcheck) throw new Error(missingToolMessage(["shellcheck"]));
  const result = runTool(shellcheck, ["--severity=style", "--format=gcc", ...files], { cwd: root });
  return result.ok ? [] : result.output.split("\n").filter(Boolean);
}

/** Failures for repo-relative shell and PowerShell files. */
export function shellFailures({ root, shellFiles, powershellFiles = [] }: ShellRequest): string[] {
  const headers = shellFiles.flatMap((file) => headerFailures(file, readFileSync(`${root}/${file}`, "utf8")));
  const powershell = powershellFiles.flatMap((file) => powershellFileFailures(file, readFileSync(`${root}/${file}`, "utf8")));
  return [...headers, ...shellcheckFailures(root, shellFiles), ...powershell];
}
