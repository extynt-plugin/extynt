/** The fake After Effects folder and footage project items, with the interpretation enums a footage file exposes. */

/** What a footage file's interpretation looks like to a script: enum values that differ from their names. */
export const FAKE_ALPHA_MODE = { IGNORE: "ignore-alpha", STRAIGHT: "straight-alpha", PREMULTIPLIED: "premult-alpha" };

/** The field separation enum values the fake footage reports. */
export const FAKE_FIELD_SEPARATION = { OFF: "fields-off", UPPER_FIELD_FIRST: "fields-upper", LOWER_FIELD_FIRST: "fields-lower" };

/** A project folder. */
export class FakeFolderItem {
  public typeName = "Folder";
  public parentFolder: FakeFolderItem | null = null;
  public removed = false;

  public constructor(public id: string, public name: string) {}

  public remove(): void {
    this.removed = true;
  }
}

/** A footage file's interpretation: plain settable fields plus the guess calls, which record themselves. */
export class FakeFootageSource {
  public isStill = false;
  public hasAlpha = true;
  public nativeFrameRate = 24;
  public conformFrameRate = 24;
  public displayFrameRate = 24;
  public alphaMode = FAKE_ALPHA_MODE.STRAIGHT;
  public premulColor = [0, 0, 0];
  public loop = 1;
  public pixelAspect = 1;
  public fieldSeparationType = FAKE_FIELD_SEPARATION.OFF;
  public invertAlpha = false;
  public highQualityFieldSeparation = false;
  public removePulldown = "pulldown-off";
  public guesses: string[] = [];

  public guessAlphaMode(): void {
    this.guesses.push("alpha");
    this.alphaMode = FAKE_ALPHA_MODE.PREMULTIPLIED;
  }

  public guessPulldown(method: string): void {
    this.guesses.push(`pulldown:${method}`);
    this.removePulldown = "pulldown-WSSWW";
  }
}

/** A footage project item that records replace, proxy and remove calls. */
export class FakeFootageItem {
  public mainSource = new FakeFootageSource();
  public duration = 10;
  public frameRate = 24;
  public sequenceImport: { sequence: boolean; forceAlphabetical: boolean } | null = null;
  public parentFolder: FakeFolderItem | null = null;
  public removed = false;
  public replacedPath: string | null = null;
  public proxyPath: string | null = null;

  public constructor(public id: string, public name: string) {}

  public replace(file: { fsName: string }): void {
    this.replacedPath = file.fsName;
  }

  public setProxy(file: { fsName: string }): void {
    this.proxyPath = file.fsName;
  }

  public setProxyToNone(): void {
    this.proxyPath = null;
  }

  public remove(): void {
    this.removed = true;
  }
}
