/** The fake render queue: items that record their templates and output file, and a render that marks them done and writes their files. */

import type { FakeCompItem } from "./host-fake-comp.js";
import type { FakeFile, FakeFileStore } from "./host-apply-files.js";
import { fakeOutputModuleSettings, fakeQueueInAME, fakeRenderItemSettings, type OutputFakeControls, type SettingsHolder } from "./host-output-fake.js";

const QUEUED_STATUS = 3015;
const DONE_STATUS = 3019;
const RENDERED_FILE_BYTES = 4096;

/** One queued render and the templates applied to it. */
export interface QueuedRender {
  comp: FakeCompItem;
  renderTemplate?: string;
  outputTemplate?: string;
  outputPath?: string;
}

/** How often the queue rendered and what it was asked to queue. */
export interface RenderLog {
  calls: number;
  queued: QueuedRender[];
}

interface FakeOutputModule extends SettingsHolder {
  applyTemplate(name: string): void;
  file: FakeFile | null;
}

interface FakeRenderItem extends SettingsHolder {
  status: number;
  render: boolean;
  applyTemplate(name: string): void;
  outputModule(): FakeOutputModule;
  remove(): void;
}

/** The `app.project.renderQueue` object the harness hands the host. */
export interface FakeRenderQueue {
  readonly items: { readonly length: number; item(index: number): FakeRenderItem | null; add(comp: FakeCompItem): FakeRenderItem };
  queueInAME(start: boolean): void;
  render(): void;
}

function newRenderItem(controls: OutputFakeControls, log: RenderLog, items: FakeRenderItem[], comp: FakeCompItem): FakeRenderItem {
  const outputModule: FakeOutputModule = {
    applyTemplate: (name) => {
      const last = log.queued[log.queued.length - 1];
      if (last) last.outputTemplate = name;
    },
    file: null,
    ...fakeOutputModuleSettings(controls),
  };
  const item: FakeRenderItem = {
    status: QUEUED_STATUS,
    render: true,
    applyTemplate: (name) => {
      log.queued.push({ comp, renderTemplate: name });
    },
    outputModule: () => outputModule,
    remove: () => {
      items.splice(items.indexOf(item), 1);
    },
    ...fakeRenderItemSettings(controls),
  };
  return item;
}

function finishRender(item: FakeRenderItem, store: FakeFileStore): void {
  item.status = DONE_STATUS;
  const file = item.outputModule().file;
  if (!file) return;
  store.sizes.set(file.fsName, RENDERED_FILE_BYTES);
  file.exists = true;
  file.length = RENDERED_FILE_BYTES;
}

/** A render queue whose items live in a list, with `log` recording queue and render calls and `store` receiving rendered files. */
export function buildRenderQueue(controls: OutputFakeControls, log: RenderLog, store: FakeFileStore): FakeRenderQueue {
  const renderItems: FakeRenderItem[] = [];
  const rendering = (): FakeRenderItem[] => renderItems.filter((item) => item.render);
  return {
    items: {
      get length() {
        return renderItems.length;
      },
      item: (index) => renderItems[index - 1] ?? null,
      add: (comp) => {
        const item = newRenderItem(controls, log, renderItems, comp);
        log.queued.push({ comp });
        renderItems.push(item);
        return item;
      },
    },
    queueInAME: fakeQueueInAME(controls, () => rendering().map((item) => String(item.status))),
    render: () => {
      log.calls += 1;
      for (const item of rendering()) finishRender(item, store);
    },
  };
}
