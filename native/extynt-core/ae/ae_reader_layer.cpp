// Layer-level reads (everything in a layer object except its property tree).
#include <array>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>

#include "A.h"
#include "AE_BlendModes.h"
#include "AE_GeneralPlug.h"
#include "ae_reader.h"
#include "sdk_ref.h"
#include "host_reader.h"
#include "layer_rules.h"

namespace extynt::ae {

namespace {

struct BlendName {
  PF_TransferMode mode;
  const char* name;
};

constexpr std::array<BlendName, 37> kBlendNames = {{
    {PF_Xfer_IN_FRONT, "NORMAL"},
    {PF_Xfer_DISSOLVE, "DISSOLVE"},
    {PF_Xfer_ADD, "ADD"},
    {PF_Xfer_MULTIPLY, "MULTIPLY"},
    {PF_Xfer_SCREEN, "SCREEN"},
    {PF_Xfer_OVERLAY, "OVERLAY"},
    {PF_Xfer_SOFT_LIGHT, "SOFT_LIGHT"},
    {PF_Xfer_HARD_LIGHT, "HARD_LIGHT"},
    {PF_Xfer_DARKEN, "DARKEN"},
    {PF_Xfer_LIGHTEN, "LIGHTEN"},
    {PF_Xfer_DIFFERENCE, "CLASSIC_DIFFERENCE"},
    {PF_Xfer_DIFFERENCE2, "DIFFERENCE"},
    {PF_Xfer_HUE, "HUE"},
    {PF_Xfer_SATURATION, "SATURATION"},
    {PF_Xfer_COLOR, "COLOR"},
    {PF_Xfer_LUMINOSITY, "LUMINOSITY"},
    {PF_Xfer_MULTIPLY_ALPHA, "STENCIL_ALPHA"},
    {PF_Xfer_MULTIPLY_ALPHA_LUMA, "STENCIL_LUMA"},
    {PF_Xfer_MULTIPLY_NOT_ALPHA, "SILHOUETE_ALPHA"},
    {PF_Xfer_MULTIPLY_NOT_ALPHA_LUMA, "SILHOUETTE_LUMA"},
    {PF_Xfer_ADDITIVE_PREMUL, "LUMINESCENT_PREMUL"},
    {PF_Xfer_ALPHA_ADD, "ALPHA_ADD"},
    {PF_Xfer_COLOR_DODGE, "CLASSIC_COLOR_DODGE"},
    {PF_Xfer_COLOR_BURN, "CLASSIC_COLOR_BURN"},
    {PF_Xfer_EXCLUSION, "EXCLUSION"},
    {PF_Xfer_COLOR_DODGE2, "COLOR_DODGE"},
    {PF_Xfer_COLOR_BURN2, "COLOR_BURN"},
    {PF_Xfer_LINEAR_DODGE, "LINEAR_DODGE"},
    {PF_Xfer_LINEAR_BURN, "LINEAR_BURN"},
    {PF_Xfer_LINEAR_LIGHT, "LINEAR_LIGHT"},
    {PF_Xfer_VIVID_LIGHT, "VIVID_LIGHT"},
    {PF_Xfer_PIN_LIGHT, "PIN_LIGHT"},
    {PF_Xfer_HARD_MIX, "HARD_MIX"},
    {PF_Xfer_LIGHTER_COLOR, "LIGHTER_COLOR"},
    {PF_Xfer_DARKER_COLOR, "DARKER_COLOR"},
    {PF_Xfer_SUBTRACT, "SUBTRACT"},
    {PF_Xfer_DIVIDE, "DIVIDE"},
}};

const char* blendModeName(PF_TransferMode mode) {
  for (const BlendName& entry : kBlendNames) {
    if (entry.mode == mode) return entry.name;
  }
  return nullptr;
}

MatteType matteTypeOf(AEGP_TrackMatte matte) {
  switch (matte) {
    case AEGP_TrackMatte_ALPHA: return MatteType::Alpha;
    case AEGP_TrackMatte_NOT_ALPHA: return MatteType::AlphaInverted;
    case AEGP_TrackMatte_LUMA: return MatteType::Luma;
    case AEGP_TrackMatte_NOT_LUMA: return MatteType::LumaInverted;
    default: return MatteType::None;
  }
}

LayerType layerTypeOf(AEGP_ObjectType object, AEGP_LayerFlags flags) {
  if (object == AEGP_ObjectType_TEXT) return LayerType::Text;
  if (object == AEGP_ObjectType_VECTOR) return LayerType::Shape;
  if (object == AEGP_ObjectType_CAMERA) return LayerType::Camera;
  if (object == AEGP_ObjectType_LIGHT) return LayerType::Light;
  if ((flags & AEGP_LayerFlag_NULL_LAYER) != 0) return LayerType::Null;
  if ((flags & AEGP_LayerFlag_ADJUSTMENT_LAYER) != 0) return LayerType::Adjustment;
  return LayerType::Av;
}

const char* frameBlendingName(AEGP_LayerFlags flags) {
  if ((flags & AEGP_LayerFlag_ADVANCED_FRAME_BLENDING) != 0) return "PIXEL_MOTION";
  if ((flags & AEGP_LayerFlag_FRAME_BLENDING) != 0) return "FRAME_MIX";
  return "NO_FRAME_BLEND";
}

const char* qualityName(AEGP_LayerQuality quality) {
  if (quality == AEGP_LayerQual_BEST) return "BEST";
  if (quality == AEGP_LayerQual_DRAFT) return "DRAFT";
  return "WIREFRAME";
}

}

void AeReader::fillLayerTiming(AEGP_LayerH layer, LayerRow& row) {
  A_Time inPoint = {0, 1};
  A_Time duration = {0, 1};
  A_Time offset = {0, 1};
  if (soft(s_->layer->AEGP_GetLayerInPoint(layer, AEGP_LTimeMode_CompTime, &inPoint), "AEGP_GetLayerInPoint"))
    row.inPoint = seconds(inPoint);
  if (soft(s_->layer->AEGP_GetLayerDuration(layer, AEGP_LTimeMode_CompTime, &duration), "AEGP_GetLayerDuration"))
    row.outPoint = row.inPoint + seconds(duration);
  if (soft(s_->layer->AEGP_GetLayerOffset(layer, &offset), "AEGP_GetLayerOffset")) row.startTime = seconds(offset);
  A_Ratio stretch = {1, 1};
  if (soft(s_->layer->AEGP_GetLayerStretch(layer, &stretch), "AEGP_GetLayerStretch") && stretch.den != 0) {
    row.stretchPercent = 100.0 * static_cast<double>(stretch.num) / static_cast<double>(stretch.den);
  }
}

void AeReader::fillLayerMatte(AEGP_LayerH layer, LayerRow& row) {
  AEGP_LayerH matte = nullptr;
  if (isNonAvLayerType(row.type) ||
      !soft(s_->layer->AEGP_GetTrackMatteLayer(layer, &matte), "AEGP_GetTrackMatteLayer") || matte == nullptr)
    return;
  row.matteLayerId = layerIdOf(matte);
  AEGP_LayerTransferMode transfer;
  std::memset(&transfer, 0, sizeof transfer);
  if (soft(s_->layer->AEGP_GetLayerTransferMode(layer, &transfer), "AEGP_GetLayerTransferMode"))
    row.matteType = matteTypeOf(transfer.track_matte);
}

void AeReader::fillLayerRelations(AEGP_LayerH layer, LayerRow& row) {
  AEGP_LayerH parent = nullptr;
  if (soft(s_->layer->AEGP_GetLayerParent(layer, &parent), "AEGP_GetLayerParent") && parent != nullptr)
    row.parentId = layerIdOf(parent);
  fillLayerMatte(layer, row);
  AEGP_ItemH source = nullptr;
  if (soft(s_->layer->AEGP_GetLayerSourceItem(layer, &source), "AEGP_GetLayerSourceItem") && source != nullptr) {
    row.sourceId = itemId(source);
    AEGP_ItemType type = AEGP_ItemType_NONE;
    if (soft(s_->item->AEGP_GetItemType(source, &type), "AEGP_GetItemType") && type == AEGP_ItemType_COMP)
      row.compositionSourceId = row.sourceId;
  }
}

void AeReader::fillLayerRendering(AEGP_LayerH layer, LayerRow& row) {
  LayerSwitches& s = row.switches;
  const bool isAv = !isNonAvLayerType(row.type);
  AEGP_LayerTransferMode transfer;
  std::memset(&transfer, 0, sizeof transfer);
  if (isAv && soft(s_->layer->AEGP_GetLayerTransferMode(layer, &transfer), "AEGP_GetLayerTransferMode")) {
    const char* name = blendModeName(transfer.mode);
    if (name != nullptr) s.blendMode = std::string(name);
  }
  if (isAv) fillLayerSampling(layer, row);
}

void AeReader::fillLayerSampling(AEGP_LayerH layer, LayerRow& row) {
  LayerSwitches& s = row.switches;
  AEGP_LayerQuality quality = AEGP_LayerQual_NONE;
  if (quiet(s_->layer->AEGP_GetLayerQuality(layer, &quality), "AEGP_GetLayerQuality")) {
    s.quality = std::string(qualityName(quality));
  }
  AEGP_LayerSamplingQuality sampling = AEGP_LayerSamplingQual_BILINEAR;
  if (quiet(s_->layer->AEGP_GetLayerSamplingQuality(layer, &sampling), "AEGP_GetLayerSamplingQuality")) {
    s.sampling = std::string(sampling == AEGP_LayerSamplingQual_BICUBIC ? "BICUBIC" : "BILINEAR");
  }
}

void AeReader::fillLayerSwitches(AEGP_LayerH layer, AEGP_LayerFlags flags, LayerRow& row) {
  LayerSwitches& s = row.switches;
  s.motionBlur = (flags & AEGP_LayerFlag_MOTION_BLUR) != 0;
  s.collapseTransformation = (flags & AEGP_LayerFlag_COLLAPSE) != 0;
  s.guideLayer = (flags & AEGP_LayerFlag_GUIDE_LAYER) != 0;
  s.adjustment = (flags & AEGP_LayerFlag_ADJUSTMENT_LAYER) != 0;
  s.effectsActive = (flags & AEGP_LayerFlag_EFFECTS_ACTIVE) != 0;
  s.frameBlending = std::string(frameBlendingName(flags));
  fillLayerRendering(layer, row);
}

LayerRow AeReader::layerRow(AEGP_LayerH layer) {
  LayerRow row;
  row.id = layerIdOf(layer);
  A_long index = 0;
  if (soft(s_->layer->AEGP_GetLayerIndex(layer, &index), "AEGP_GetLayerIndex"))
    row.index = static_cast<int64_t>(index) + 1;

  AEGP_MemHandle layerName = nullptr;
  AEGP_MemHandle sourceName = nullptr;
  if (soft(s_->layer->AEGP_GetLayerName(pluginId_, layer, &layerName, &sourceName), "AEGP_GetLayerName")) {
    row.name = takeText(layerName);
    const std::string source = takeText(sourceName);
    if (row.name.empty()) row.name = source;
  }
  loadSelection();
  row.selected = selected_.count(row.id) > 0;
  AEGP_LabelID label = 0;
  if (soft(s_->layer->AEGP_GetLayerLabel(layer, &label), "AEGP_GetLayerLabel"))
    row.label = static_cast<int64_t>(static_cast<unsigned char>(label));

  AEGP_LayerFlags flags = 0;
  soft(s_->layer->AEGP_GetLayerFlags(layer, &flags), "AEGP_GetLayerFlags");
  AEGP_ObjectType object = AEGP_ObjectType_NONE;
  soft(s_->layer->AEGP_GetLayerObjectType(layer, &object), "AEGP_GetLayerObjectType");
  row.type = layerTypeOf(object, flags);
  row.enabled = (flags & AEGP_LayerFlag_VIDEO_ACTIVE) != 0;
  row.shy = (flags & AEGP_LayerFlag_SHY) != 0;
  row.solo = (flags & AEGP_LayerFlag_SOLO) != 0;
  row.locked = (flags & AEGP_LayerFlag_LOCKED) != 0;
  row.threeD = (flags & AEGP_LayerFlag_LAYER_IS_3D) != 0;
  row.audioEnabled = (flags & AEGP_LayerFlag_AUDIO_ACTIVE) != 0;
  fillLayerTiming(layer, row);
  fillLayerRelations(layer, row);
  fillLayerSwitches(layer, flags, row);
  applyDomLayerRules(row);
  return row;
}

LayerRef AeReader::layerAt(int64_t index1, LayerRow& out) {
  if (comp_ == nullptr) throw HostFailure("no composition is open", 0, "INTERNAL");
  AEGP_LayerH layer = nullptr;
  hard(s_->layer->AEGP_GetCompLayerByIndex(comp_, static_cast<A_long>(index1 - 1), &layer), "AEGP_GetCompLayerByIndex");
  if (layer == nullptr) throw HostFailure("layer " + std::to_string(index1) + " is missing", 0, "HOST_ERROR");
  out = layerRow(layer);
  return layerRef(layer);
}

bool AeReader::layerById(const Id& layerId, LayerRef& ref, LayerRow& out) {
  if (comp_ == nullptr) return false;
  char* end = nullptr;
  const long id = std::strtol(layerId.c_str(), &end, 10);
  if (end == layerId.c_str() || *end != '\0') return false;
  AEGP_LayerH layer = nullptr;
  if (!soft(s_->layer->AEGP_GetLayerFromLayerID(comp_, static_cast<AEGP_LayerIDVal>(id), &layer),
            "AEGP_GetLayerFromLayerID") ||
      layer == nullptr)
    return false;
  out = layerRow(layer);
  ref = layerRef(layer);
  return true;
}

}
