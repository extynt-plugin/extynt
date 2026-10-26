/**
 * The fake After Effects property groups that accept new children: effect, mask and shape parades and the text
 * animator groups. Built on FakeProperty from host-fake-property.ts.
 */

import { FakeProperty, type FakeValue } from "./host-fake-property.js";

type LeafSpec = readonly [matchName: string, name: string, value: FakeValue];

const GAUSSIAN_BLUR = "ADBE Gaussian Blur 2";

const MASK_LEAVES: readonly LeafSpec[] = [
  ["ADBE Mask Shape", "Mask Path", "M 0 0"],
  ["ADBE Mask Opacity", "Mask Opacity", 100],
  ["ADBE Mask Feather", "Mask Feather", [0, 0]],
  ["ADBE Mask Offset", "Mask Expansion", 0],
];

const SHAPE_CONTENT_LEAVES: ReadonlyMap<string, readonly LeafSpec[]> = new Map([
  ["ADBE Vector Shape - Group", [["ADBE Vector Shape", "Path", "M 0 0"]]],
  ["ADBE Vector Graphic - Fill", [["ADBE Vector Fill Rule", "Fill Rule", 1], ["ADBE Vector Fill Color", "Color", [1, 1, 1]], ["ADBE Vector Fill Opacity", "Opacity", 100]]],
  ["ADBE Vector Graphic - Stroke", [
    ["ADBE Vector Stroke Color", "Color", [1, 1, 1]],
    ["ADBE Vector Stroke Opacity", "Opacity", 100],
    ["ADBE Vector Stroke Width", "Width", 1],
    ["ADBE Vector Stroke Line Cap", "Line Cap", 1],
    ["ADBE Vector Stroke Line Join", "Line Join", 1],
    ["ADBE Vector Stroke Miter Limit", "Miter Limit", 4],
  ]],
]);

function leavesOf(specs: readonly LeafSpec[]): FakeProperty[] {
  return specs.map(([matchName, name, value]) => new FakeProperty(matchName, name, [], value, true));
}

function staleLeaf(name: string, message: string): FakeProperty {
  const stale = new FakeProperty("ADBE Text Opacity", name, [], 100, true);
  stale.isHidden = true;
  stale.setValue = () => {
    throw new Error(message);
  };
  return stale;
}

class FakeMaskAtom extends FakeProperty {
  public constructor(private readonly parade: FakeProperty) {
    super("ADBE Mask Atom", "Mask", leavesOf(MASK_LEAVES), null, false);
  }

  public remove(): void {
    const index = this.parade.children.indexOf(this);
    if (index >= 0) this.parade.children.splice(index, 1);
  }
}

/** An effect parade that can add a Gaussian Blur. */
export class FakeEffectParade extends FakeProperty {
  public constructor(children: FakeProperty[] = []) {
    super("ADBE Effect Parade", "Effects", children, null, false);
  }

  public override canAddProperty(matchName: string): boolean {
    return matchName === GAUSSIAN_BLUR;
  }

  public override addProperty(matchName: string): FakeProperty | null {
    if (!this.canAddProperty(matchName)) return null;
    const blurriness = new FakeProperty("ADBE Gaussian Blur 2-0001", "Blurriness", [], 0, true);
    const effect = new FakeProperty(matchName, "Gaussian Blur", [blurriness], null, false);
    this.children.push(effect);
    return effect;
  }
}

/** A mask parade that adds removable mask atoms. */
export class FakeMaskParade extends FakeProperty {
  public constructor(children: FakeProperty[] = []) {
    super("ADBE Mask Parade", "Masks", children, null, false);
  }

  public override addProperty(matchName: string): FakeProperty | null {
    if (matchName !== "ADBE Mask Atom") return null;
    const mask = new FakeMaskAtom(this);
    this.children.push(mask);
    return mask;
  }
}

/** The Contents group of a shape group: adds a path, a fill or a stroke. */
export class FakeShapeContents extends FakeProperty {
  public constructor() {
    super("ADBE Vectors Group", "Contents", [], null, false);
  }

  public override addProperty(matchName: string): FakeProperty | null {
    const specs = SHAPE_CONTENT_LEAVES.get(matchName);
    if (!specs) return null;
    const child = new FakeProperty(matchName, matchName, leavesOf(specs), null, false);
    this.children.push(child);
    return child;
  }
}

class FakeShapeGroup extends FakeProperty {
  public propertyIndex = 0;

  public constructor() {
    const opacity = new FakeProperty("ADBE Vector Group Opacity", "Opacity", [], 100, true);
    const transform = new FakeProperty("ADBE Vector Transform Group", "Transform", [opacity], null, false);
    super("ADBE Vector Group", "Group", [new FakeShapeContents(), transform], null, false);
  }
}

/** The root Contents group of a shape layer: adds groups. */
export class FakeShapeRoot extends FakeProperty {
  public freshWrappers = false;

  public constructor(children: FakeProperty[] = []) {
    super("ADBE Root Vectors Group", "Contents", children, null, false);
  }

  public override addProperty(matchName: string): FakeProperty | null {
    if (matchName !== "ADBE Vector Group") return null;
    const group = new FakeShapeGroup();
    this.children.push(group);
    group.propertyIndex = this.children.length;
    return group;
  }

  public override property(index: number | string): FakeProperty | null {
    const child = super.property(index);
    if (!child || !this.freshWrappers) return child;
    return new Proxy(child, {});
  }
}

/** The Range Selectors group of a text animator. */
export class FakeTextSelectors extends FakeProperty {
  public constructor() {
    super("ADBE Text Selectors", "Range Selectors", [], null, false);
  }

  public override addProperty(matchName: string): FakeProperty | null {
    if (matchName !== "ADBE Text Selector") return null;
    const start = new FakeProperty("ADBE Text Percent Start", "Start", [], 0, true);
    const end = new FakeProperty("ADBE Text Percent End", "End", [], 100, true);
    const selector = new FakeProperty("ADBE Text Selector", "Range Selector 1", [start, end], null, false);
    this.children.push(selector);
    return selector;
  }
}

/** The Add group of a text animator: inserting returns a stale reference, so the host must not use it. */
export class FakeTextAnimatorProperties extends FakeProperty {
  public constructor() {
    super("ADBE Text Animator Properties", "Add", [], null, false);
  }

  public override addProperty(matchName: string): FakeProperty | null {
    if (matchName !== "ADBE Text Opacity") return null;
    this.children.push(new FakeProperty("ADBE Text Opacity", "Opacity", [], 100, true));
    return staleLeaf("stale opacity", "stale indexed-group reference");
  }
}

/** A text animator whose own addProperty returns a stale object, so the host must use its documented Properties group. */
export class FakeTextAnimator extends FakeProperty {
  public constructor() {
    super("ADBE Text Animator", "Animator 1", [new FakeTextSelectors(), new FakeTextAnimatorProperties()], null, false);
  }

  public override addProperty(matchName: string): FakeProperty | null {
    if (matchName !== "ADBE Text Opacity") return null;
    return staleLeaf("stale animator opacity", "stale animator insertion");
  }
}

/** The Animators group of a text layer. */
export class FakeTextAnimators extends FakeProperty {
  public constructor() {
    super("ADBE Text Animators", "Animators", [], null, false);
  }

  public override addProperty(matchName: string): FakeProperty | null {
    if (matchName !== "ADBE Text Animator") return null;
    const animator = new FakeTextAnimator();
    this.children.push(animator);
    return animator;
  }
}

/** A group that adds children from a table of factories keyed by match name. */
export class FakeAddGroup extends FakeProperty {
  private readonly factories: ReadonlyMap<string, () => FakeProperty>;

  public constructor(matchName: string, factories: Readonly<Record<string, () => FakeProperty>>, children: FakeProperty[] = []) {
    super(matchName, matchName, children, null, false);
    this.factories = new Map(Object.entries(factories));
  }

  public override addProperty(matchName: string): FakeProperty | null {
    const make = this.factories.get(matchName);
    if (!make) return null;
    const child = make();
    this.children.push(child);
    return child;
  }
}
