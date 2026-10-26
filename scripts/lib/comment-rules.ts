// Entry point of the comments stage: picks the language rules for a file and returns its failures.
import { cppCommentFailures } from "./comments/cpp-comments.ts";
import { extendscriptCommentFailures } from "./comments/extendscript-comments.ts";
import { innoCommentFailures } from "./inno-rules.ts";
import { languageOf } from "./language.ts";
import { scriptCommentFailures } from "./comments/script-comments.ts";
import { typescriptCommentFailures } from "./comments/typescript-comments.ts";
import type { SourceEntry } from "./source-entry.ts";

type CommentRule = (key: string, text: string) => string[];

const RULES_BY_EXTENSION = new Map<string, CommentRule>([
  [".ts", typescriptCommentFailures], [".tsx", typescriptCommentFailures], [".mjs", typescriptCommentFailures],
  [".jsx", extendscriptCommentFailures],
  [".h", cppCommentFailures], [".cpp", cppCommentFailures], [".m", cppCommentFailures], [".mm", cppCommentFailures],
  [".sh", scriptCommentFailures], [".ps1", scriptCommentFailures], [".iss", innoCommentFailures],
]);

/** Comment-policy failures for one { key, text } entry; files of unknown type have none. */
export function commentFailures({ key, text }: SourceEntry): string[] {
  const rules = RULES_BY_EXTENSION.get(languageOf(key, text));
  return rules ? rules(key, text) : [];
}
