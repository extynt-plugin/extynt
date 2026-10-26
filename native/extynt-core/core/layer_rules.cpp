// Implements the layer rules declared in layer_rules.h: layer kinds without video and enabled-from-flags.

#include "layer_rules.h"
#include <cstdint>
#include "host_reader.h"

namespace extynt {

bool isNonAvLayerType(LayerType type) { return type == LayerType::Camera || type == LayerType::Light; }

const char* layerTypeName(LayerType type) {
  switch (type) {
    case LayerType::Text: return "text";
    case LayerType::Shape: return "shape";
    case LayerType::Camera: return "camera";
    case LayerType::Light: return "light";
    case LayerType::Null: return "null";
    case LayerType::Adjustment: return "adjustment";
    case LayerType::Av: return "av";
  }
  return "av";
}

const char* matteTypeName(MatteType type) {
  switch (type) {
    case MatteType::None: return "none";
    case MatteType::Alpha: return "alpha";
    case MatteType::AlphaInverted: return "alpha-inverted";
    case MatteType::Luma: return "luma";
    case MatteType::LumaInverted: return "luma-inverted";
  }
  return "none";
}

bool enabledFromDynFlags(int64_t flags) {
  return (flags & kDynFlagActiveEyeball) != 0 && (flags & kDynFlagHidden) == 0;
}

void applyDomLayerRules(LayerRow& row) {
  if (!isNonAvLayerType(row.type)) return;
  row.threeD = false;
  LayerSwitches& s = row.switches;
  s.blendMode.reset();
  s.quality.reset();
  s.sampling.reset();
  s.frameBlending.reset();
  s.motionBlur = false;
  s.collapseTransformation = false;
  s.guideLayer = false;
  s.adjustment = false;
  s.effectsActive = false;
}

}
