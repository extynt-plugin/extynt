/** The ExtendScript enums and small host classes the apply_plan harness exposes as globals; plain values are enough for the fake. */

import { FAKE_ALPHA_MODE, FAKE_FIELD_SEPARATION, FakeFootageSource } from "./host-fake-footage.js";

/** The footage interpretation globals. */
export const FOOTAGE_GLOBALS = {
  PulldownPhase: { OFF: "pulldown-off", WSSWW: "pulldown-WSSWW", SSWWW: "pulldown-SSWWW", SWWWS: "pulldown-SWWWS", WWWSS: "pulldown-WWWSS", WWSSW: "pulldown-WWSSW" },
  PulldownMethod: { PULLDOWN_3_2: "method-3-2", ADVANCE_24P: "method-24p" },
  FileSource: FakeFootageSource,
  AlphaMode: FAKE_ALPHA_MODE,
  FieldSeparationType: FAKE_FIELD_SEPARATION,
  SceneEditDetectionMode: { MARKERS: "scene-markers", SPLIT: "scene-split", SPLIT_PRECOMP: "scene-split-precomp" },
};

/** The ExtendScript enums the host files read. */
export const HOST_ENUM_GLOBALS = {
  RQItemStatus: { WILL_CONTINUE: 3012, NEEDS_OUTPUT: 3013, UNQUEUED: 3014, QUEUED: 3015, RENDERING: 3016, USER_STOPPED: 3017, ERR_STOPPED: 3018, DONE: 3019 },
  MaskMode: { NONE: 6612, ADD: 6613, SUBTRACT: 6614, INTERSECT: 6615, LIGHTEN: 6616, DARKEN: 6617, DIFFERENCE: 6618 },
  ImportAsType: { FOOTAGE: "footage", COMP: "composition", COMP_CROPPED_LAYERS: "composition-cropped-layers", PROJECT: "project" },
  KeyframeInterpolationType: { LINEAR: "linear", HOLD: "hold", BEZIER: "bezier" },
  BlendingMode: { NORMAL: "normal", MULTIPLY: "multiply", SCREEN: "screen", OVERLAY: "overlay", LIGHTEN: "lighten", DARKEN: "darken", DIFFERENCE: "difference", ADD: "add" },
  TrackMatteType: { ALPHA: "alpha", ALPHA_INVERTED: "alpha-inverted", LUMA: "luma", LUMA_INVERTED: "luma-inverted", NO_TRACK_MATTE: "no-track-matte" },
  ParagraphJustification: { LEFT_JUSTIFY: 7413, CENTER_JUSTIFY: 7415, RIGHT_JUSTIFY: 7414, FULL_JUSTIFY_LASTLINE_LEFT: 7416 },
  FontCapsOption: { FONT_NORMAL_CAPS: 11012, FONT_SMALL_CAPS: 11013, FONT_ALL_CAPS: 11014, FONT_ALL_SMALL_CAPS: 11015 },
  BoxVerticalAlignment: { TOP: 12812, CENTER: 12813, BOTTOM: 12814, JUSTIFY: 12815 },
  GetSettingsFormat: { STRING: "string", NUMBER_SETTINGS: "number", STRING_SETTABLE: "settable", SPEC: "spec" },
};

/** The ExtendScript KeyframeEase. */
export class FakeKeyframeEase {
  public constructor(public speed: number, public influence: number) {}
}

/** The ExtendScript MarkerValue. */
export class FakeMarkerValue {
  public duration = 0;
  public chapter = "";
  public url = "";
  public cuePointName = "";
  public label = 0;

  public constructor(public comment: string) {}
}
