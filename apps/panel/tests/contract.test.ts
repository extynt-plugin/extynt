/** The shared harness for the panel contract suites: main.js, the stub DOM from index.html, a fake sidecar behind the XHR stub and the native host's injected session. */
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import { StubDocument, StubElement } from "./contract-dom.js";
import { createXhrClass, defaultSidecar, sidecarResponder, type FakeSidecar, type StubRequestRecord, type StubResponder, type StubXhr } from "./contract-xhr.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

export { StubElement } from "./contract-dom.js";
export type { StubRequestRecord, StubResponse, FakeSidecar } from "./contract-xhr.js";

/** A timer the panel armed on the stub clock. */
export type StubTimer = { id: number; fn: () => void; ms: number; kind: "timeout" | "interval"; cleared: boolean; fired: boolean };

/** What the native host injects as window.__extyntNative. */
export const NATIVE = { pluginVersion: "0.1.0", aeVersion: "26.2", sidecarOrigin: "http://127.0.0.1:3210", token: "test-token", theme: { background: "#16171b", luminance: 0.09 } };

/** How a test starts the panel. */
export type PanelHarnessOptions = {
  respond?: StubResponder;
  sidecar?: (sidecar: FakeSidecar) => void;
  native?: JsonObject | null;
  prefersDark?: boolean;
  buildId?: JsonValue;
};

type WindowEvent = { type: string; detail?: JsonValue };
type WindowListener = (event: WindowEvent) => void;
type WindowRig = { options: PanelHarnessOptions; listeners: Map<string, WindowListener[]>; reload: () => void; clipboard: string[] };

function createTimerRig() {
  const timeouts: StubTimer[] = [];
  const intervals: StubTimer[] = [];
  let nextId = 1;
  const arm = (list: StubTimer[], kind: StubTimer["kind"]) => (fn: () => void, ms?: number): number => {
    const timer: StubTimer = { id: nextId++, fn, ms: ms ?? 0, kind, cleared: false, fired: false };
    list.push(timer);
    return timer.id;
  };
  const clear = (list: StubTimer[]) => (id: number): void => {
    const timer = list.find((entry) => entry.id === id);
    if (timer) timer.cleared = true;
  };
  const pendingTimeouts = (): StubTimer[] => timeouts.filter((timer) => !timer.cleared && !timer.fired);
  const runTimeouts = (filter: (timer: StubTimer) => boolean = () => true): number => {
    const due = pendingTimeouts().filter(filter);
    for (const timer of due) {
      timer.fired = true;
      timer.fn();
    }
    return due.length;
  };
  const runIntervals = (filter: (timer: StubTimer) => boolean = () => true): number => {
    const due = intervals.filter((timer) => !timer.cleared).filter(filter);
    for (const timer of due) timer.fn();
    return due.length;
  };
  return { setTimeoutStub: arm(timeouts, "timeout"), setIntervalStub: arm(intervals, "interval"), clearTimeoutStub: clear(timeouts), clearIntervalStub: clear(intervals), pendingTimeouts, runTimeouts, runIntervals };
}

let virtualNow: () => number = () => Date.now();

/** "Now" on the newest harness clock, for timestamps a test hands the panel; unlike Date.now() it does not drift ahead of the panel while a test runs. */
export const testNow = (): number => virtualNow();

/** A virtual clock frozen at creation and moved only by advance(), so a delay computed from two readings of "now" never depends on wall time. */
export function createClock() {
  const RealDate = Date;
  const start = RealDate.now();
  let offset = 0;
  class FakeDate extends RealDate {
    public constructor(...args: [] | [number | string | Date]) {
      if (args.length === 0) super(start + offset);
      else super(args[0]);
    }
    public static override now(): number {
      return start + offset;
    }
  }
  return { FakeDate, now: (): number => start + offset, advance: (ms: number): void => { offset += ms; } };
}

/** A one-pixel PNG as a data URL. */
export const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function panelSource(buildId: JsonValue | undefined): string {
  const source = readFileSync("apps/panel/main.js", "utf8");
  return buildId === undefined ? source : source.replace(/^window\.__EXTYNT_PANEL_BUILD_ID__ = .*;$/m, () => "window.__EXTYNT_PANEL_BUILD_ID__ = " + JSON.stringify(buildId) + ";");
}

class StubFileReader {
  public result: string | undefined;
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public readAsDataURL(file: { dataUrl?: string }): void {
    this.result = file.dataUrl;
    this.onload?.();
  }
}

class StubImage {}
class StubInput {}

function windowFields(rig: WindowRig) {
  const native = rig.options.native === undefined ? NATIVE : rig.options.native;
  return {
    ...(native ? { __extyntNative: Object.freeze({ ...native }) } : {}),
    location: { origin: "http://127.0.0.1:3210", reload: rig.reload },
    addEventListener: (type: string, listener: WindowListener): void => {
      rig.listeners.set(type, [...(rig.listeners.get(type) ?? []), listener]);
    },
    crypto: webcrypto,
    innerHeight: 600,
    innerWidth: 360,
    navigator: { clipboard: { writeText: (text: string): Promise<void> => { rig.clipboard.push(text); return Promise.resolve(); } } },
    matchMedia: (): { matches: boolean } => ({ matches: rig.options.prefersDark === true }),
  };
}

type StubWindow = ReturnType<typeof windowFields> & { __EXTYNT_PRODUCT_VERSION__?: string; showSaveFilePicker?: () => void };

function createWindow(rig: WindowRig): StubWindow {
  return windowFields(rig);
}

function quietConsole() {
  return { debug: (): void => {}, log: (): void => {}, warn: (): void => {}, error: (): void => {} };
}

/** Boots main.js against the stub DOM and a fake sidecar, and returns the levers a contract test pulls. */
export function createPanelHarness(options: PanelHarnessOptions = {}) {
  const doc = new StubDocument();
  const sidecar = defaultSidecar();
  options.sidecar?.(sidecar);
  const requests: StubRequestRecord[] = [];
  const events: string[] = [];
  const clipboard: string[] = [];
  const windowListeners = new Map<string, WindowListener[]>();
  let reloads = 0;
  const timers = createTimerRig();
  const { FakeDate, advance, now } = createClock();
  virtualNow = now;
  const fake = sidecarResponder(sidecar);
  const respond: StubResponder = (record) => options.respond?.(record) ?? fake(record);
  const { StubXhr: Xhr, held } = createXhrClass({ requests, note: (kind, detail) => { events.push(kind + " " + detail); }, respond });
  const windowStub = createWindow({ options, listeners: windowListeners, reload: () => { reloads += 1; }, clipboard });
  const context = vm.createContext({
    document: doc, window: windowStub, crypto: webcrypto, XMLHttpRequest: Xhr,
    setTimeout: timers.setTimeoutStub, clearTimeout: timers.clearTimeoutStub, setInterval: timers.setIntervalStub, clearInterval: timers.clearIntervalStub,
    JSON, Date: FakeDate, Error, TypeError, SyntaxError, Math, String, Number, Object, Array, RegExp, isFinite, parseInt, parseFloat, Boolean, Reflect, Set, Map, Promise,
    console: quietConsole(), HTMLElement: StubElement, HTMLInputElement: StubInput, Image: StubImage, FileReader: StubFileReader, encodeURIComponent, decodeURIComponent, btoa, atob,
  });
  vm.runInContext(panelSource(options.buildId), context);
  return harnessOver({ doc, window: windowStub, sidecar, requests, events, clipboard, timers, advance, held, windowListeners, reloads: () => reloads });
}

type Rig = {
  doc: StubDocument;
  window: ReturnType<typeof createWindow>;
  sidecar: FakeSidecar;
  requests: StubRequestRecord[];
  events: string[];
  clipboard: string[];
  timers: ReturnType<typeof createTimerRig>;
  advance: (ms: number) => void;
  held: StubXhr[];
  windowListeners: Map<string, WindowListener[]>;
  reloads: () => number;
};

function harnessOver(rig: Rig) {
  const { doc, held } = rig;
  const streams = (): StubXhr[] => held.filter((xhr) => xhr.url.endsWith("/v1/ui/events") && !xhr.ended);
  const pushStream = (text: string): boolean => {
    const stream = streams()[0];
    if (stream) stream.push(text);
    return stream !== undefined;
  };
  return {
    document: doc,
    window: rig.window,
    sidecar: rig.sidecar,
    requests: rig.requests,
    events: rig.events,
    clipboard: rig.clipboard,
    el: (id: string): StubElement | null => doc.getElementById(id),
    body: (): StubElement => doc.body,
    click: (id: string): boolean => doc.getElementById(id)?.click() ?? false,
    runTimeouts: rig.timers.runTimeouts,
    runIntervals: rig.timers.runIntervals,
    pendingTimeouts: rig.timers.pendingTimeouts,
    advance: rig.advance,
    held: () => held,
    requestsTo: (path: string): StubRequestRecord[] => rig.requests.filter((record) => record.url.includes(path)),
    reloads: rig.reloads,
    dispatchWindow: (type: string, extra: { detail?: JsonValue } = {}): void => {
      for (const listener of [...(rig.windowListeners.get(type) ?? [])]) listener({ type, ...extra });
    },
    sse: (name: string, data: JsonValue): boolean => pushStream("event: " + name + "\ndata: " + JSON.stringify(data) + "\n\n"),
    sseRaw: pushStream,
    streamCount: (): number => streams().length,
    dropStream: (): void => streams()[0]?.fail(),
    send: (text: string): void => {
      const composer = doc.getElementById("chat-message");
      if (composer) composer.value = text;
      doc.getElementById("chat")?.click();
    },
  };
}

/** What createPanelHarness returns. */
export type PanelHarness = ReturnType<typeof createPanelHarness>;
