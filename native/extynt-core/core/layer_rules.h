// Where the object model (ExtendScript DOM, which probe.jsx reads) and After Effects' own layer flags
// disagree, the DOM wins: the plugin must report what the probe reports. Pure core.
#pragma once

#include "host_reader.h"

namespace extynt {

// Camera and light layers are not AVLayers: the DOM has no threeDLayer, quality, frameBlendingType,
// samplingQuality or blendingMode on them (probe.jsx reads those as false / null), while the flags AEGP
// returns can say otherwise (a camera reports LAYER_IS_3D and a WIREFRAME quality). Rewrites the row to
// the DOM's answer: threeD false, quality / sampling / frame-blending / blend-mode null, and the plain
// boolean switches (motion blur, collapse, guide, adjustment, effects active) false.
void applyDomLayerRules(LayerRow& row);

// True for the layer types the rule above covers.
bool isNonAvLayerType(LayerType type);

// The protocol's lower-case name of a layer type: text, shape, camera, light, null, adjustment or av.
const char* layerTypeName(LayerType type);

// The protocol's name of a matte type: none, alpha, alpha-inverted, luma or luma-inverted.
const char* matteTypeName(MatteType type);

// The AEGP_DynStreamFlags bit for an active eyeball (1 << 0); the DOM's `enabled` depends on it.
constexpr int64_t kDynFlagActiveEyeball = 1;

// The AEGP_DynStreamFlags bit for a hidden stream (1 << 1). Bit 3 (0x8) is undocumented in the SDK header but occurs
// on live streams (see docs/native/plugin-design.md).
constexpr int64_t kDynFlagHidden = 2;

// The DOM's PropertyBase.enabled from a stream's raw flag word: eyeball on and not HIDDEN. Measured on AE
// 26.2.1 over 1,116 entries; the DISABLED bit (1 << 4) never occurs and Layer Styles' Blend Options Group
// (flags 3 = EYEBALL|HIDDEN) is false in the DOM, so "not DISABLED" was the wrong rule.
bool enabledFromDynFlags(int64_t flags);

}
