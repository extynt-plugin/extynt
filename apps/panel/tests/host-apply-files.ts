/** The fake ExtendScript File, Folder and ImportOptions classes the apply_plan harness hands the host. */

const FIXTURE_FILES: ReadonlySet<string> = new Set(["/fixtures/title.mov", "/fixtures/replacement.mov", "/fixtures/proxy.mov"]);
const FIXTURE_PATTERNS: readonly RegExp[] = [/^\/presets\//, /^\/fixtures\/artwork\.(ai|eps|pdf)$/];
const FIXTURE_BYTES = 1024;

function isFixturePath(fsName: string): boolean {
  return FIXTURE_FILES.has(fsName) || FIXTURE_PATTERNS.some((pattern) => pattern.test(fsName));
}

/** Paths a fake host write produced, with their sizes and text: apply_plan verifies some writes by reading the file back. */
export interface FakeFileStore {
  readonly sizes: Map<string, number>;
  readonly contents: Map<string, string>;
}

/** A file whose existence comes from fixture paths and from earlier writes recorded in the store. */
export class FakeFile {
  public exists: boolean;
  public length: number;
  public alias = false;
  public encoding = "UTF-8";
  public lineFeed = "Unix";
  private mode = "";

  public constructor(public fsName: string, private readonly store: FakeFileStore) {
    const fixture = isFixturePath(fsName);
    this.exists = fixture || store.sizes.has(fsName);
    this.length = store.sizes.get(fsName) ?? (fixture ? FIXTURE_BYTES : 0);
  }

  public get name(): string {
    return this.fsName.slice(this.fsName.lastIndexOf("/") + 1);
  }

  public get parent(): { fsName: string; exists: boolean } {
    return { fsName: this.fsName.slice(0, this.fsName.lastIndexOf("/")) || "/", exists: true };
  }

  public open(mode: string): boolean {
    this.mode = mode;
    return mode === "w" || this.exists;
  }

  public write(text: string): boolean {
    if (this.mode !== "w") return false;
    this.store.contents.set(this.fsName, text);
    this.length = Buffer.byteLength(text, "utf8");
    this.store.sizes.set(this.fsName, this.length);
    this.exists = true;
    return true;
  }

  public read(): string {
    return this.store.contents.get(this.fsName) ?? "";
  }

  public close(): boolean {
    this.mode = "";
    return true;
  }

  public rename(name: string): boolean {
    if (!this.exists) return false;
    const path = `${this.parent.fsName}/${name}`;
    const content = this.store.contents.get(this.fsName);
    this.store.sizes.set(path, this.length);
    if (content !== undefined) this.store.contents.set(path, content);
    this.forget();
    this.fsName = path;
    return true;
  }

  public remove(): boolean {
    this.forget();
    this.exists = false;
    this.length = 0;
    return true;
  }

  private forget(): void {
    this.store.sizes.delete(this.fsName);
    this.store.contents.delete(this.fsName);
  }
}

/** The `File` constructor the host sees: one argument, backed by `store`. */
export function fakeFileClass(store: FakeFileStore): new (fsName: string) => FakeFile {
  return class StoredFile extends FakeFile {
    public constructor(fsName: string) {
      super(fsName, store);
    }
  };
}

/** The ExtendScript `Folder` the harness exposes: a user-data location that always exists. */
export class FakeHostFolder {
  public static userData = { fsName: "/user-data" };
  public exists = true;
  public alias = false;

  public constructor(public fsName: string) {}

  public create(): boolean {
    this.exists = true;
    return true;
  }
}

/** Counters the fake ImportOptions bumps so tests can see how the host probed the importer. */
export interface ImportOptionCounters {
  options: number;
  canImportAs: number;
}

/** An ImportOptions that counts its construction and answers canImportAs from a per-run rule. */
export class FakeImportOptions {
  public importAs: string | undefined;
  public sequence: boolean | undefined;
  public forceAlphabetical: boolean | undefined;

  public constructor(public file: FakeFile, private readonly counters: ImportOptionCounters, private readonly canImport: (importAs: string) => boolean) {
    counters.options += 1;
  }

  public canImportAs(importAs: string): boolean {
    this.counters.canImportAs += 1;
    return this.canImport(importAs);
  }
}

/** The `ImportOptions` constructor the host sees: one file argument, counted in `counters`, answering canImportAs with `canImport`. */
export function importOptionsClass(counters: ImportOptionCounters, canImport: (importAs: string) => boolean): new (file: FakeFile) => FakeImportOptions {
  return class CountedImportOptions extends FakeImportOptions {
    public constructor(file: FakeFile) {
      super(file, counters, canImport);
    }
  };
}
