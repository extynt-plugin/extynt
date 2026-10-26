// Turns a probe's font census into a LOCAL font file for `extynt-chat-tests derive --fonts`, so a live
// run on your own machine has your real typefaces. The committed fixtures are synthetic: a real census
// is host data and is never written into the repository, so both arguments are required and the
// output must be outside tools/chat-tests/fixtures.
//
//   node tools/chat-tests/seed-fonts.ts <open-questions.json> <out-file>
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { array, decodeOrThrow, fallback, number, object, optional, skippingInvalid, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";

const FONT = object({
  postScriptName: string({ nonEmpty: true }),
  family: optional(fallback(string(), undefined)),
  style: optional(fallback(string(), undefined)),
});
const CENSUS = object({
  records: optional(fallback(skippingInvalid(FONT), undefined)),
  recordCount: optional(fallback(number(), undefined)),
  familyCount: optional(fallback(number(), undefined)),
  duplicatePostScriptNames: optional(fallback(number(), undefined)),
});
const REPORT = object({ questions: array(object({ id: string(), data: optional(fallback(CENSUS, undefined)) })) });

type Census = Infer<typeof CENSUS>;
type Font = Infer<typeof FONT>;

interface SeedFixture {
  readonly note: string;
  readonly source: string;
  readonly totalReported: number | undefined;
  readonly familiesReported: number | undefined;
  readonly duplicatePostScriptNames: number | undefined;
  readonly fonts: ReadonlyArray<Font>;
}

function readCensus(reportPath: string): Census {
  const report = decodeOrThrow(REPORT, JSON.parse(readFileSync(reportPath, "utf8")));
  const question = report.questions.find((entry) => entry.id === "q13-font-census");
  if (!question) throw new Error(`${reportPath} has no q13-font-census entry`);
  return question.data ?? {};
}

function seedFixture(reportPath: string, census: Census): SeedFixture {
  const records = census.records ?? [];
  return {
    note: `A real font census, read from app.fonts.allFonts on the Mac by the host-validator PROBE (${reportPath}, q13-font-census). ${records.length} of the ${census.recordCount} records the host reported: the probe caps its report at 2048, so this is a prefix and not the whole list. Families are the host's own grouping.`,
    source: reportPath,
    totalReported: census.recordCount,
    familiesReported: census.familyCount,
    duplicatePostScriptNames: census.duplicatePostScriptNames,
    fonts: records.map((font) => ({ family: font.family, style: font.style, postScriptName: font.postScriptName })),
  };
}

const [reportPath, outPath] = process.argv.slice(2);
if (!reportPath || !outPath) throw new Error("usage: seed-fonts.ts <open-questions.json> <out-file outside tools/chat-tests/fixtures>");
if (resolve(outPath).includes(`${sep}tools${sep}chat-tests${sep}fixtures${sep}`)) throw new Error("refusing to write a real font census into the committed fixtures; choose a path outside the repository");
const census = readCensus(reportPath);
const records = census.records ?? [];
if (!records.length) throw new Error("the census carries no usable PostScript names; nothing to seed");

const families = new Set(records.map((font) => font.family).filter(Boolean));
writeFileSync(outPath, `${JSON.stringify(seedFixture(reportPath, census), null, 2)}\n`);
process.stdout.write(`seeded ${records.length} fonts across ${families.size} families from a host that reported ${census.recordCount} records in ${census.familyCount} families (${census.duplicatePostScriptNames} duplicate PostScript names)\n`);
