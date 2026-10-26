// Popup menu labels: the effects on a layer and, for each popup parameter, its '|'-separated item text. Read-only.
#include <array>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

#include "A.h"
#include "AE_Effect.h"
#include "AE_GeneralPlug.h"
#include "ae_reader.h"
#include "ae_resources.h"
#include "sdk_bits.h"
#include "sdk_ref.h"
#include "host_reader.h"

namespace extynt::ae {

namespace {

constexpr size_t kMaxMenuTextBytes = 16384;

std::string boundedText(const char* text) {
  if (text == nullptr) return {};
  size_t length = 0;
  while (length < kMaxMenuTextBytes && text[length] != '\0') ++length;
  return {text, length};
}

}

std::string AeReader::effectParamMatchName(AEGP_EffectRefH effect, A_long paramIndex) {
  AEGP_StreamRefH stream = nullptr;
  if (!soft(s_->stream->AEGP_GetNewEffectStreamByIndex(pluginId_, effect, paramIndex, &stream),
            "AEGP_GetNewEffectStreamByIndex") ||
      stream == nullptr)
    return {};
  const ScopeGuard dispose([this, stream] { soft(s_->stream->AEGP_DisposeStream(stream), "AEGP_DisposeStream"); });
  std::array<char, AEGP_MAX_STREAM_MATCH_NAME_SIZE> match{};
  if (!soft(s_->dynamic->AEGP_GetMatchName(stream, match.data()), "AEGP_GetMatchName")) return {};
  return {match.data()};
}

bool AeReader::readPopupParam(AEGP_EffectRefH effect, A_long paramIndex, PopupParam& out) {
  PF_ParamType type = PF_Param_RESERVED;
  PF_ParamDefUnion def;
  std::memset(&def, 0, sizeof def);
  if (!quiet(s_->effect->AEGP_GetEffectParamUnionByIndex(pluginId_, effect, paramIndex, &type, &def),
             "AEGP_GetEffectParamUnionByIndex") ||
      type != PF_Param_POPUP)
    return false;
  const PF_PopupDef& popup = popupDef(def);
  const char* const names = popupChoiceNames(popup);
  if (names == nullptr) return false;
  out.names = boundedText(names);
  out.numChoices = popup.num_choices;
  out.matchName = effectParamMatchName(effect, paramIndex);
  return !out.matchName.empty();
}

EffectPopups AeReader::readEffectPopups(AEGP_EffectRefH effect) {
  EffectPopups out;
  AEGP_InstalledEffectKey key = AEGP_InstalledEffectKey_NONE;
  std::array<char, AEGP_MAX_EFFECT_MATCH_NAME_SIZE> match{};
  if (soft(s_->effect->AEGP_GetInstalledKeyFromLayerEffect(effect, &key), "AEGP_GetInstalledKeyFromLayerEffect") &&
      soft(s_->effect->AEGP_GetEffectMatchName(key, match.data()), "AEGP_GetEffectMatchName"))
    out.matchName = match.data();
  A_long params = 0;
  if (!soft(s_->stream->AEGP_GetEffectNumParamStreams(effect, &params), "AEGP_GetEffectNumParamStreams")) return out;
  for (A_long index = 1; index < params; ++index) {
    PopupParam popup;
    if (readPopupParam(effect, index, popup)) out.popups.push_back(std::move(popup));
  }
  return out;
}

std::vector<EffectPopups> AeReader::layerEffectPopups(LayerRef layer) {
  requireSuites();
  A_long count = 0;
  hard(s_->effect->AEGP_GetLayerNumEffects(layerHandle(layer), &count), "AEGP_GetLayerNumEffects");
  std::vector<EffectPopups> effects;
  for (A_long index = 0; index < count; ++index) {
    AEGP_EffectRefH effect = nullptr;
    hard(s_->effect->AEGP_GetLayerEffectByIndex(pluginId_, layerHandle(layer), index, &effect),
         "AEGP_GetLayerEffectByIndex");
    const ScopeGuard dispose([this, effect] { soft(s_->effect->AEGP_DisposeEffect(effect), "AEGP_DisposeEffect"); });
    effects.push_back(readEffectPopups(effect));
  }
  return effects;
}

}
