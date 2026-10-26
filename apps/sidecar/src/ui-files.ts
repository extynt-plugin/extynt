// Atomic JSON persistence for the UI store: temp file in the same directory, then rename over the target.
import { decodeOrThrow, fallback, jsonValue, map, object, string, type Decoder, type JsonValue } from "@extynt/decode";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

/** Keeps the unreadable bytes beside the file so nothing is lost, and says so on stderr. */
export function setAside(file: string, at: Date): void {
  const preserved = `${file}.corrupt-${at.toISOString().replace(/[:.]/g, "-")}`;
  try { renameSync(file, preserved); } catch { return; }
  process.stderr.write(`[extynt] ${file} could not be loaded and was set aside as ${preserved}; the UI store started empty.\n`);
}

const fileMissing: Decoder<boolean> = fallback(map(object({ code: string() }), (facts) => facts.code === "ENOENT"), false);

/** The parsed file, or undefined when it is absent; a file that cannot be read or parsed is set aside first. */
export function loadJsonFile(file: string, at: Date): JsonValue | undefined {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch (error) {
    if (!decodeOrThrow(fileMissing, error)) setAside(file, at);
    return undefined;
  }
  try {
    return decodeOrThrow(jsonValue, JSON.parse(text));
  } catch {
    setAside(file, at);
    return undefined;
  }
}

/** A crash leaves either the old file or the new one, never a torn one; a stray temp file is never read. */
export function writeJsonAtomic<Document>(directory: string, name: string, value: Document): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temp = join(directory, `${name}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
    renameSync(temp, join(directory, name));
  } finally { rmSync(temp, { force: true }); }
}
