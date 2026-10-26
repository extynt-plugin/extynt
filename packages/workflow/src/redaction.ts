// Text redaction: bounded scrubbing of credentials and executable host detail before text reaches a model prompt or a diagnostic.

import { MAX_WORKFLOW_SUMMARY_LENGTH } from "./limits.js";

const RAW_HOST_SCRIPT_RE = /(?:#target\b|<\/?script\b|\b(?:app\s*\.\s*project|thisLayer|activeItem)\b|\b(?:eval|new\s+File|function)\s*\(|\.(?:jsx|jsxbin)\b|\b(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=|=>)/i;
const SENSITIVE_KEY = "(?:api[_-]?key|token|secret|password|authorization|credential)";
const SENSITIVE_QUOTED_ASSIGNMENT_RE = new RegExp(`\\b(${SENSITIVE_KEY})\\b\\s*([:=]\\s*)("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')`, "gi");
const SENSITIVE_UNQUOTED_ASSIGNMENT_RE = new RegExp(`\\b(${SENSITIVE_KEY})\\b\\s*([:=]\\s*)(?!["'])([^\\s,;}'"]+)`, "gi");
const SENSITIVE_PREFIX_RE = /\b(?:sk|rk|xoxb|ghp|github_pat)[_-][A-Za-z0-9_-]{4,}\b/gi;
const SENSITIVE_BEARER_QUOTED_RE = /\bbearer\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi;
const SENSITIVE_BEARER_UNQUOTED_RE = /\bbearer\s+(?!["'])([^\s,;}'"]+)/gi;
const SENSITIVE_ASSIGNMENT_TEST_RE = new RegExp(`\\b${SENSITIVE_KEY}\\b\\s*(?:[:=]\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;}'"]+)`, "i");
const SENSITIVE_BEARER_TEST_RE = /\bbearer\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}'"]+)/i;
const SENSITIVE_PREFIX_TEST_RE = /\b(?:sk|rk|xoxb|ghp|github_pat)[_-][A-Za-z0-9_-]{4,}\b/i;

/** Canonical bounded redaction shared by workflow continuation and sidecar diagnostics: complete quoted values are matched before normalization and truncation so no quoted suffix survives. */
export function redactWorkflowText(value: string, max = MAX_WORKFLOW_SUMMARY_LENGTH): string {
  if (RAW_HOST_SCRIPT_RE.test(value)) return "[redacted-host-detail]";
  const redacted = value
    .replace(SENSITIVE_BEARER_QUOTED_RE, "bearer [redacted]")
    .replace(SENSITIVE_BEARER_UNQUOTED_RE, "bearer [redacted]")
    .replace(SENSITIVE_QUOTED_ASSIGNMENT_RE, "$1$2[redacted]")
    .replace(SENSITIVE_UNQUOTED_ASSIGNMENT_RE, "$1$2[redacted]")
    .replace(SENSITIVE_PREFIX_RE, "[redacted]");
  return redacted.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Whether the text looks like executable host detail or a credential. */
export function looksSensitive(value: string): boolean {
  return RAW_HOST_SCRIPT_RE.test(value) || SENSITIVE_ASSIGNMENT_TEST_RE.test(value) || SENSITIVE_BEARER_TEST_RE.test(value) || SENSITIVE_PREFIX_TEST_RE.test(value);
}
