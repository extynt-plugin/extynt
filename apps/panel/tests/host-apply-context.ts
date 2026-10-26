/**
 * Typed reads of the fake host objects an apply-plan suite pokes after the harness has loaded them: the `app` global, the
 * render queue and the `File` class, each checked once, so no suite casts a value that crossed the vm boundary.
 */

import vm from "node:vm";
import type { UndoApp } from "./host-undo-rig.js";
import type { FakeCompItem } from "./host-fake-comp.js";
import type { FakeValue } from "./host-fake-property.js";
import { arrayOf, numberAt, plain } from "./json-narrow.js";

/** A file the fake host reports on: the render queue's output and the files the host wrote. */
export interface RenderFile {
  fsName: string;
  exists: boolean;
  length: number;
}

/** The output module of a render queue item. */
export interface OutputModule {
  file: RenderFile | null;
}

/** One queued render. */
export interface QueueItem {
  status: number;
  outputModule(): OutputModule;
}

/** The items of the render queue. */
export interface QueueItems {
  readonly length: number;
  item(index: number): QueueItem | null;
  add(comp: FakeCompItem): QueueItem;
}

/** The render queue of the fake project. */
export interface RenderQueue {
  render(): void;
  items: QueueItems;
}

/** What the fake `File` class gives a script. */
export interface FakeFile {
  readonly fsName: string;
  readonly exists: boolean;
  readonly length: number;
  readonly name: string;
}

/** The fake `File` constructor. */
export type FakeFileConstructor = new (path: string) => FakeFile;

/** A file the fake project remembers as its saved location. */
export interface FakeProjectFile {
  readonly fsName: string;
  readonly name?: string;
  readonly parent?: { readonly fsName: string; readonly exists: boolean };
}

/** The slice of the fake host's `app.project` these suites drive. */
export interface FakeProject {
  readonly renderQueue: RenderQueue;
  activeItem?: FakeCompItem | null;
  file?: FakeProjectFile | null;
  save?: (target?: FakeProjectFile) => void;
  bitsPerChannel?: number;
  linearBlending?: boolean;
}

/** The slice of the fake host's `app` these suites drive. */
export interface FakeApp {
  readonly project: FakeProject;
  findMenuCommandId?: (name: string) => number;
  executeCommand?: (id: number) => void;
}

/** The fake `app` and `File` class a loader built for a context, kept as the typed objects the loader created. */
export interface HostFakes {
  readonly app: FakeApp & UndoApp;
  readonly fileClass: FakeFileConstructor;
}

const fakesByContext = new WeakMap<vm.Context, HostFakes>();

/** Records the fakes a loader put into `context`, so a suite reads them back by the types they were built with. */
export function registerHostFakes(context: vm.Context, fakes: HostFakes): void {
  fakesByContext.set(context, fakes);
}

function fakesOf(context: vm.Context): HostFakes {
  const fakes = fakesByContext.get(context);
  if (fakes === undefined) throw new TypeError("no fake host was registered for this context");
  return fakes;
}

/** The fake `app` global a loader built, for tests that change what the host sees. */
export function appOf(context: vm.Context): FakeApp {
  return fakesOf(context).app;
}

/** The same fake `app`, seen with its undo-group methods. */
export function undoAppOf(context: vm.Context): UndoApp {
  return fakesOf(context).app;
}

/** The queue item at the 1-based index; a missing item is a test failure. */
export function queuedItem(queue: RenderQueue, index: number): QueueItem {
  const item = queue.items.item(index);
  if (item === null) throw new Error(`the render queue has no item ${index}`);
  return item;
}

/** The render queue of the project in the harness context. */
export function renderQueueOf(context: vm.Context): RenderQueue {
  return appOf(context).project.renderQueue;
}

/** The fake `File` class a loader installed, for tests that extend it. */
export function fileClassOf(context: vm.Context): FakeFileConstructor {
  return fakesOf(context).fileClass;
}

/** Copies a host-realm array of numbers into this realm; anything else throws. */
export function numbersOf(candidate: FakeValue | undefined): number[] {
  return arrayOf(plain(candidate)).map((entry) => numberAt(entry));
}
