// The one notes preference that lives outside the catalogue: "Learn from my work", on by default, kept in a small JSON file beside the other per-user state.
import { boolean, decodeJson, object } from "@extynt/decode";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = "effect-notes-settings.json";
const stored = object({ learnFromWork: boolean() });

/** The user's "Learn from my work" setting. */
export class EffectNotesSettings {
  private learn: boolean | undefined;

  constructor(private readonly directory: string) {}

  private path(): string {
    return join(this.directory, FILE);
  }

  private load(): boolean {
    try {
      const decoded = decodeJson(readFileSync(this.path(), "utf8"), stored);
      return decoded.ok ? decoded.value.learnFromWork : true;
    } catch {
      return true;
    }
  }

  learnFromWork(): boolean {
    this.learn ??= this.load();
    return this.learn;
  }

  setLearnFromWork(value: boolean): boolean {
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.path()}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify({ learnFromWork: value })}\n`, { mode: 0o600 });
      renameSync(temporary, this.path());
      this.learn = value;
      return true;
    } catch {
      return false;
    }
  }
}
