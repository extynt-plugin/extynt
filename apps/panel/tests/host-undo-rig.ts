/**
 * A fake After Effects host with an undo stack for the apply-plan undo-group suites: every write is logged with the
 * undo-group depth it ran at, command 16 pops one undo step, and a position write that changes the value is a step.
 */

import { type JsonObject } from "@extynt/decode";
import { type FakeCompItem, type FakeProperty, loadApplyPlan } from "./host-apply-harness.js";
import { childNamed, layerProperty } from "./host-fake-lookup.js";
import { applyPlan } from "./host-plan-io.js";
import { undoAppOf } from "./host-apply-context.js";

/** A render queue item the rig can take back. */
export interface RenderItem {
  remove: () => void;
}

/** The render queue calls whose undo-group depth the render suites observe. */
export interface RenderQueue {
  items: { add: (comp: FakeCompItem) => RenderItem };
  render: () => void;
  queueInAME: (start: boolean) => void;
}

/** The slice of the fake `app` the rig instruments. */
export interface UndoApp {
  project: {
    activeItem?: FakeCompItem;
    items: { addComp: (name: string, ...settings: number[]) => FakeCompItem };
    renderQueue: RenderQueue;
  };
  beginUndoGroup: (name: string) => void;
  endUndoGroup: () => void;
  executeCommand?: (id: number) => void;
}

/**
 * The apply-plan fake host with undo bookkeeping. The title layer starts selected in the open composition, and the first
 * position write deselects it, as After Effects does when a step adds a layer.
 */
export class UndoRig {
  public readonly events: string[] = [];
  public readonly loose: string[] = [];
  public readonly pressed: number[] = [];
  public readonly stack: Array<() => void> = [];
  public readonly loaded = loadApplyPlan();
  public readonly app: UndoApp & { readonly project: { revision: number } };
  public readonly position: FakeProperty;
  public depth = 0;
  public maxDepth = 0;
  public selected = true;
  private deselected = false;

  public constructor() {
    const base = undoAppOf(this.loaded.context);
    this.app = Object.assign(base, { project: Object.assign(base.project, { revision: 1 }) });
    this.position = childNamed(layerProperty(this.loaded.title, "ADBE Transform Group"), "ADBE Position");
    this.app.project.activeItem = this.loaded.comp;
    this.trackGroups();
    this.trackUndoCommand();
    this.trackSelection();
    this.trackViewer();
    this.trackPositionWrites();
  }

  public apply(planId: string, operations: JsonObject[], batchSize?: number): JsonObject {
    return applyPlan(this.loaded.apply, planId, operations, batchSize === undefined ? {} : { batchSize });
  }

  private write(label: string): void {
    this.events.push(`${label}@${this.depth}`);
    if (this.depth === 0) this.loose.push(label);
  }

  private trackGroups(): void {
    const begin = this.app.beginUndoGroup;
    const end = this.app.endUndoGroup;
    this.app.beginUndoGroup = (name) => {
      this.depth += 1;
      this.maxDepth = Math.max(this.maxDepth, this.depth);
      this.events.push("begin");
      begin(name);
    };
    this.app.endUndoGroup = () => {
      this.depth -= 1;
      this.events.push("end");
      end();
    };
  }

  private trackUndoCommand(): void {
    this.app.executeCommand = (id) => {
      this.pressed.push(id);
      this.events.push(`undo@${this.depth}`);
      const inverse = this.stack.pop();
      if (!inverse) throw new Error("nothing to undo");
      inverse();
      this.app.project.revision += 1;
    };
  }

  private trackSelection(): void {
    Object.defineProperty(this.loaded.title, "selected", {
      configurable: true,
      get: () => this.selected,
      set: (next: boolean) => {
        this.write(`select:${next}`);
        this.selected = next;
      },
    });
  }

  private watchViewer(comp: FakeCompItem): void {
    Object.assign(comp, { openInViewer: () => this.write(`viewer:${comp.name}`) });
  }

  private trackViewer(): void {
    const items = this.app.project.items;
    const addComp = items.addComp;
    this.watchViewer(this.loaded.comp);
    items.addComp = (name, ...settings) => {
      const created = addComp(name, ...settings);
      this.app.project.revision += 1;
      this.watchViewer(created);
      return created;
    };
  }

  private deselectOnce(): void {
    if (this.deselected) return;
    this.deselected = true;
    this.loaded.title.selected = false;
  }

  private trackPositionWrites(): void {
    const setValue = this.position.setValue.bind(this.position);
    this.position.setValue = (next) => {
      if (typeof next === "string") throw new Error("PROPERTY_WRITE_FAILED: bad value");
      this.deselectOnce();
      const before = this.position.value;
      if (JSON.stringify(before) !== JSON.stringify(next)) {
        this.stack.push(() => {
          this.position.value = before;
        });
        this.app.project.revision += 1;
      }
      setValue(next);
    };
  }
}
