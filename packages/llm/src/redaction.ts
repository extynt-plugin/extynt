/** Redacts secrets and file paths from strings headed for a model, and truncates long ones. A path may contain spaces ("/Users/alice/My Project/footage/hero.png"), so a component is a bounded run of words and only a word ending in a known file extension can end the path; a lone dot cannot ("backup.2024" is a name, not an extension). */
import { isJsonArray } from "@extynt/decode";
import type { JsonValue } from "@extynt/decode";
import type { RedactionReport } from "./types.js";

export interface RedactionConfig {
  maxStringLength: number;
  includeFilePaths: boolean;
}

export const DEFAULT_REDACTION_CONFIG: RedactionConfig = { maxStringLength: 240, includeFilePaths: false };

export interface RedactedValue { value: JsonValue; report: RedactionReport; }

const PATH_FILE_EXTENSIONS = [
  "aep", "aepx", "aet", "mogrt", "ffx", "prproj", "drp", "c4d", "blend", "fbx", "obj", "gltf", "glb",
  "png", "jpg", "jpeg", "gif", "webp", "avif", "heic", "bmp", "tif", "tiff", "tga", "exr", "dpx", "hdr", "dds", "ico", "psd", "psb", "ai", "eps", "svg", "pdf",
  "mp4", "m4v", "mov", "avi", "mkv", "webm", "wmv", "flv", "mpg", "mpeg", "mxf", "r3d", "braw", "wav", "mp3", "aif", "aiff", "m4a", "aac", "flac", "ogg", "opus", "wma",
  "txt", "rtf", "md", "csv", "tsv", "json", "xml", "yaml", "yml", "log", "srt", "vtt", "zip", "gz", "tar", "7z", "rar", "dmg", "iso", "exe", "msi", "app",
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "html", "htm", "css", "ttf", "otf", "woff", "woff2",
].join("|");
const PATH_TAIL_WORDS = 12;
const PATH_WORD = String.raw`[^\s/\\,;:!?)\]}"'][^\s/\\"']*(?:['’][^\s/\\"']+)*`;
const PATH_CONTINUES = String.raw`(?<![.!?])(?:(?<!\.(?:${PATH_FILE_EXTENSIONS}))|(?=[ \t]+${PATH_WORD}[\\/]))`;
const PATH_COMPONENT = String.raw`${PATH_WORD}(?:${PATH_CONTINUES}[ \t]+${PATH_WORD}){0,${PATH_TAIL_WORDS}}`;
const PATH_PATTERN = new RegExp(String.raw`(?:^|[\s"'])((?:[A-Za-z]:[\\/]|\\\\|\/)(?:${PATH_COMPONENT}[\\/])*${PATH_COMPONENT})`, "gi");

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/gi,
  /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
];

export interface RedactedText { value: string; report: RedactionReport; }

/** Secrets become `[redacted secret]`, paths (unless the config keeps them) `[redacted path]`, and a string over the length limit is cut with an ellipsis. An option left `undefined` takes its default. */
export function redactText(input: string, config: Partial<RedactionConfig> = {}): RedactedText {
  const maxStringLength = config.maxStringLength ?? DEFAULT_REDACTION_CONFIG.maxStringLength;
  const includeFilePaths = config.includeFilePaths ?? DEFAULT_REDACTION_CONFIG.includeFilePaths;
  const report = emptyReport();
  const withoutSecrets = SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, () => {
    report.redactedSecretCount += 1;
    return "[redacted secret]";
  }), input);
  const withoutPaths = includeFilePaths ? withoutSecrets : withoutSecrets.replace(PATH_PATTERN, (match, path: string) => {
    if (!path || path === "/") return match;
    report.redactedPathCount += 1;
    return match.slice(0, match.length - path.length) + "[redacted path]";
  });
  if (withoutPaths.length <= maxStringLength) return { value: withoutPaths, report };
  report.truncatedStringCount += 1;
  return { value: `${withoutPaths.slice(0, Math.max(0, maxStringLength - 1))}…`, report };
}

export function redactJsonValue(input: JsonValue, config: Partial<RedactionConfig> = {}): RedactedValue {
  if (typeof input === "string") return redactText(input, config);
  if (isJsonArray(input)) return mergeValues(input.map((item) => redactJsonValue(item, config)));
  if (input && typeof input === "object") {
    const entries = Object.entries(input).map(([key, value]) => [key, redactJsonValue(value, config)] as const);
    return {
      value: Object.fromEntries(entries.map(([key, result]) => [key, result.value])),
      report: entries.reduce((report, [, result]) => mergeReports(report, result.report), emptyReport()),
    };
  }
  return { value: input, report: emptyReport() };
}

export function emptyReport(): RedactionReport {
  return { redactedSecretCount: 0, redactedPathCount: 0, omittedExpressionCount: 0, truncatedStringCount: 0 };
}

export function mergeReports(left: RedactionReport, right: RedactionReport): RedactionReport {
  return {
    redactedSecretCount: left.redactedSecretCount + right.redactedSecretCount,
    redactedPathCount: left.redactedPathCount + right.redactedPathCount,
    omittedExpressionCount: left.omittedExpressionCount + right.omittedExpressionCount,
    truncatedStringCount: left.truncatedStringCount + right.truncatedStringCount,
  };
}

function mergeValues(values: RedactedValue[]): RedactedValue {
  return { value: values.map((item) => item.value), report: values.reduce((report, item) => mergeReports(report, item.report), emptyReport()) };
}
