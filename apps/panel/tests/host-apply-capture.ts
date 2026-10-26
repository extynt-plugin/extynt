/** Loads the host's frame capture and discard functions against a fake composition whose saved PNG appears, appears late, or lands with a doubled extension. */

import vm from "node:vm";
import { FakeCompItem, FakeLayer } from "./host-fake-comp.js";
import { hostTextFunction, loadHostFiles } from "./host-sources.js";

/** When the saved capture file comes into existence. */
export type CaptureCreated = boolean | "delayed" | "appended";

interface CaptureLog {
  readonly saved: Array<{ time: number; path: string }>;
  readonly removed: string[];
  readonly removedFiles: Set<string>;
  saveInvoked: boolean;
  sleepCalls: number;
}

class FakeCaptureFile {
  public constructor(public fsName: string, private readonly log: CaptureLog, private readonly created: CaptureCreated) {}

  public get exists(): boolean {
    if (this.log.removedFiles.has(this.fsName)) return false;
    if (this.created === "appended") return this.fsName.endsWith(".png.png");
    if (this.created === "delayed") return this.log.saveInvoked && this.log.sleepCalls >= 2;
    return this.created && !this.fsName.endsWith(".png.png");
  }

  public remove(): void {
    this.log.removed.push(this.fsName);
    this.log.removedFiles.add(this.fsName);
  }
}

class FakeCaptureFolder {
  public static temp = { fsName: "/temporary" };
  public static userData = { fsName: "/user-data" };
  public exists = true;

  public constructor(public fsName: string) {}

  public create(): boolean {
    this.exists = true;
    return true;
  }
}

function captureFileClass(log: CaptureLog, created: CaptureCreated): new (fsName: string) => FakeCaptureFile {
  return class BoundCaptureFile extends FakeCaptureFile {
    public constructor(fsName: string) {
      super(fsName, log, created);
    }
  };
}

/** The capture and discard host functions with the composition, layer and logs they act on. */
export function loadCaptureAdapters(captureCreated: CaptureCreated = true) {
  const layer = new FakeLayer("layer-capture", [], "Before");
  const comp = new FakeCompItem("comp-capture", [layer], "Capture Comp");
  const log: CaptureLog = { saved: [], removed: [], removedFiles: new Set(), saveInvoked: false, sleepCalls: 0 };
  Object.assign(comp, {
    saveFrameToPng: (time: number, output: { fsName: string }) => {
      log.saveInvoked = true;
      log.saved.push({ time, path: output.fsName });
    },
  });
  const context = vm.createContext({
    app: { project: { numItems: 1, item: () => comp }, beginUndoGroup: () => undefined, endUndoGroup: () => undefined },
    CompItem: FakeCompItem,
    File: captureFileClass(log, captureCreated),
    Folder: FakeCaptureFolder,
    $: {
      sleep: () => {
        log.sleepCalls += 1;
      },
    },
  });
  loadHostFiles(context, "probe.jsx");
  return {
    capture: hostTextFunction(context, "aeCaptureFrame"),
    discard: hostTextFunction(context, "aeDiscardCaptureFrame"),
    comp,
    layer,
    saved: log.saved,
    removed: log.removed,
    get sleepCalls(): number {
      return log.sleepCalls;
    },
  };
}
