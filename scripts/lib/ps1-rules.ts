// PowerShell gate: the repo-wide limits (docs/coding-rules.md) measured on .ps1 files, plus strict error handling and strict mode.
// No PowerShell is needed to run it: a small tokenizer strips comments and strings, then counts lines, braces and keywords.
import { MAX_COMPLEXITY, MAX_FILE_LINES, MAX_FUNCTION_LINES, MAX_NESTING, MAX_PARAMS } from "./measure.ts";

interface BodyMetrics {
  readonly body: string;
  readonly nesting: number;
}

interface BraceState {
  depth: number;
  control: number;
  maxControl: number;
  readonly kinds: boolean[];
}

const LIMITS = { fileLines: MAX_FILE_LINES, functionLines: MAX_FUNCTION_LINES, complexity: MAX_COMPLEXITY, nesting: MAX_NESTING, parameters: MAX_PARAMS };
const CONTROL_BEFORE_BRACE = /\b(?:if|elseif|else|foreach|for|while|do|switch|try|catch|finally)\b[^{}]*$/i;
const DECISION = /\b(?:if|elseif|foreach|for|while|until|catch)\b|\s-(?:and|or)\s|\?\?/gi;
const STRICT_MODE = /^\s*Set-StrictMode\s+-Version\s+Latest\b/im;
// Scripts that predate the Set-StrictMode rule and belong to another workstream. Each entry goes in the commit that adds
// `Set-StrictMode -Version Latest` to that script; the list is meant to be empty.
export const STRICT_MODE_PENDING: ReadonlySet<string> = new Set(["native/extynt-core/build-win.ps1"]);
const FUNCTION_START = /^\s*function\s+([\w-]+)\s*(\(|\{|$)/i;

/** The text with block comments, line comments, and string contents removed, line structure preserved. */
export function stripNonCode(text: string): string {
  const withoutBlocks = text.replace(/<#[\s\S]*?#>/g, (match: string) => match.replace(/[^\n]/g, ""));
  return withoutBlocks.split("\n").map(stripLine).join("\n");
}

function stripLine(line: string): string {
  let quote = "";
  let result = "";
  for (const character of line) {
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') { quote = character; result += '""'; continue; }
    if (character === "#") break;
    result += character;
  }
  return result;
}

function topLevelSegments(text: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of text) {
    if ("([{".includes(character)) depth += 1;
    if (")]}".includes(character)) depth -= 1;
    if (character === "," && depth === 0) { segments.push(current); current = ""; continue; }
    current += character;
  }
  if (current.trim()) segments.push(current);
  return segments.filter((segment) => /\$\w+/.test(segment));
}

function balancedAfter(text: string, openIndex: number): string {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] === ")") depth -= 1;
    if (depth === 0) return text.slice(openIndex + 1, index);
  }
  return "";
}

function parameterCount(code: string, from: number): number {
  const paramBlock = /\bparam\s*\(/i.exec(code.slice(from));
  if (!paramBlock) return 0;
  return topLevelSegments(balancedAfter(code, from + paramBlock.index + paramBlock[0].length - 1)).length;
}

function declaredParameters(code: string, start: number, match: RegExpExecArray): number {
  if (match[2] === "(") return topLevelSegments(balancedAfter(code, start + match[0].length - 1)).length;
  return parameterCount(code, start);
}

function isControlBrace(code: string, index: number): boolean {
  const lineStart = code.lastIndexOf("\n", index) + 1;
  return CONTROL_BEFORE_BRACE.test(code.slice(lineStart, index));
}

function openBrace(state: BraceState, isControl: boolean): void {
  state.kinds.push(isControl);
  state.depth += 1;
  if (isControl) state.control += 1;
  state.maxControl = Math.max(state.maxControl, state.control);
}

function closeBrace(state: BraceState): boolean {
  if (state.kinds.pop()) state.control -= 1;
  state.depth -= 1;
  return state.depth === 0;
}

function bodyMetrics(code: string, start: number): BodyMetrics | null {
  const open = code.indexOf("{", start);
  if (open < 0) return null;
  const state: BraceState = { depth: 0, control: 0, maxControl: 0, kinds: [] };
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === "{") openBrace(state, isControlBrace(code, index));
    else if (code[index] === "}" && closeBrace(state)) return { body: code.slice(open, index + 1), nesting: state.maxControl };
  }
  return null;
}

function logicalLines(text: string): number {
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

function complexityOf(body: string): number {
  return 1 + (body.match(DECISION) ?? []).length;
}

function functionFailures(key: string, code: string): string[] {
  const failures: string[] = [];
  const lines = code.split("\n");
  lines.forEach((line, lineIndex) => {
    const match = FUNCTION_START.exec(line);
    if (!match) return;
    const offset = lines.slice(0, lineIndex).join("\n").length + (lineIndex ? 1 : 0);
    const where = `${key}:${lineIndex + 1}: function ${match[1]}`;
    const metrics = bodyMetrics(code, offset + match.index);
    if (!metrics) return;
    failures.push(...limitFailures(where, metrics, declaredParameters(code, offset + match.index, match)));
  });
  return failures;
}

function limitFailures(where: string, metrics: BodyMetrics, parameters: number): string[] {
  const found: string[] = [];
  const length = logicalLines(metrics.body);
  if (length > LIMITS.functionLines) found.push(`${where} has ${length} lines (limit ${LIMITS.functionLines})`);
  const complexity = complexityOf(metrics.body);
  if (complexity > LIMITS.complexity) found.push(`${where} has complexity ${complexity} (limit ${LIMITS.complexity})`);
  if (metrics.nesting > LIMITS.nesting) found.push(`${where} nests ${metrics.nesting} levels (limit ${LIMITS.nesting})`);
  if (parameters > LIMITS.parameters) found.push(`${where} has ${parameters} parameters (limit ${LIMITS.parameters})`);
  return found;
}

function scriptFailures(key: string, code: string): string[] {
  const failures: string[] = [];
  const parameters = parameterCount(code, 0);
  if (parameters > LIMITS.parameters) failures.push(`${key}: the script has ${parameters} parameters (limit ${LIMITS.parameters})`);
  const lines = logicalLines(code);
  if (lines > LIMITS.fileLines) failures.push(`${key}: ${lines} lines (limit ${LIMITS.fileLines})`);
  return failures;
}

/** Failures for one PowerShell file given its repo-relative key and text. */
export function powershellFileFailures(key: string, text: string): string[] {
  const normalized = text.replaceAll("\r\n", "\n");
  const strict = /^\s*\$ErrorActionPreference\s*=\s*'Stop'/m.test(normalized) ? [] : [`${key}: set $ErrorActionPreference = 'Stop' at script level`];
  const strictMode = STRICT_MODE.test(normalized) || STRICT_MODE_PENDING.has(key) ? [] : [`${key}: set Set-StrictMode -Version Latest at script level`];
  const code = stripNonCode(normalized);
  return [...strict, ...strictMode, ...scriptFailures(key, code), ...functionFailures(key, code)];
}
