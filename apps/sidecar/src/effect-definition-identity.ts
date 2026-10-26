// Content-addressed ids for effect and parameter definitions, so the same host, effect and path always name the same row.
import { createHash } from "node:crypto";
import { definitionNullableText, definitionText } from "./effect-definition-validate.js";

/** The stable id of an effect on one host: a hash of host key, match name and version. */
export function effectDefinitionId(hostKey: string, matchName: string, version: string | null): string {
  definitionText(hostKey); definitionText(matchName); definitionNullableText(version);
  return createHash("sha256").update(`effect\0${hostKey}\0${matchName}\0${version ?? ""}`).digest("hex");
}

/** The stable id of a parameter: a hash of its effect id and its escaped path. */
export function parameterDefinitionId(effectId: string, path: string): string {
  definitionText(effectId); definitionText(path);
  return createHash("sha256").update(`parameter\0${effectId}\0${path}`).digest("hex");
}

/** A native name as one path segment: the characters `%`, `/` and `#` are percent-escaped so segments join and split unambiguously. */
export function escapeParameterSegment(nativeName: string): string {
  return nativeName.replace(/%/g, "%25").replace(/\//g, "%2F").replace(/#/g, "%23");
}
