// Property-tree reads: dynamic streams for structure, the stream suite for values.
#include <array>
#include <cstdint>
#include <cstring>

#include "A.h"
#include "AE_GeneralPlug.h"
#include "SPTypes.h"
#include "ae_reader.h"
#include "ae_resources.h"
#include "sdk_ref.h"
#include "host_reader.h"
#include "layer_rules.h"

namespace extynt::ae {

namespace {

struct StreamTypeName {
  AEGP_StreamType type;
  ValueType value;
};

constexpr std::array<StreamTypeName, 12> kStreamTypes = {{
    {AEGP_StreamType_ThreeD_SPATIAL, ValueType::ThreeDSpatial},
    {AEGP_StreamType_ThreeD, ValueType::ThreeD},
    {AEGP_StreamType_TwoD_SPATIAL, ValueType::TwoDSpatial},
    {AEGP_StreamType_TwoD, ValueType::TwoD},
    {AEGP_StreamType_OneD, ValueType::OneD},
    {AEGP_StreamType_COLOR, ValueType::Color},
    {AEGP_StreamType_ARB, ValueType::Arb},
    {AEGP_StreamType_MARKER, ValueType::Marker},
    {AEGP_StreamType_LAYER_ID, ValueType::LayerId},
    {AEGP_StreamType_MASK_ID, ValueType::MaskId},
    {AEGP_StreamType_MASK, ValueType::Mask},
    {AEGP_StreamType_TEXT_DOCUMENT, ValueType::TextDocument},
}};

ValueType valueTypeOf(AEGP_StreamType type) {
  for (const StreamTypeName& entry : kStreamTypes) {
    if (entry.type == type) return entry.value;
  }
  return ValueType::NoData;
}

const char* unsupportedName(ValueType type) {
  switch (type) {
    case ValueType::Arb: return "arbitrary";
    case ValueType::Marker: return "marker";
    case ValueType::LayerId: return "layer-id";
    case ValueType::MaskId: return "mask-id";
    case ValueType::Mask: return "shape-path";
    case ValueType::TextDocument: return "text-document";
    default: return nullptr;
  }
}

Grouping groupingOf(AEGP_StreamGroupingType grouping) {
  if (grouping == AEGP_StreamGroupingType_NAMED_GROUP) return Grouping::Named;
  if (grouping == AEGP_StreamGroupingType_INDEXED_GROUP) return Grouping::Indexed;
  return Grouping::Leaf;
}

}

StreamRef AeReader::openLayerRoot(LayerRef layer) {
  AEGP_StreamRefH stream = nullptr;
  hard(s_->dynamic->AEGP_GetNewStreamRefForLayer(pluginId_, layerHandle(layer), &stream),
       "AEGP_GetNewStreamRefForLayer");
  if (stream == nullptr) throw HostFailure("layer has no stream root", 0, "HOST_ERROR");
  return streamRef(stream);
}

int64_t AeReader::firstChildIndex([[maybe_unused]] StreamRef group, bool groupIsEffect) {
  return groupIsEffect ? 1 : 0;
}

int64_t AeReader::childCount(StreamRef group) {
  A_long count = 0;
  if (!soft(s_->dynamic->AEGP_GetNumStreamsInGroup(streamHandle(group), &count), "AEGP_GetNumStreamsInGroup")) return 0;
  return count;
}

StreamRef AeReader::childAt(StreamRef group, int64_t index0) {
  AEGP_StreamRefH child = nullptr;
  hard(s_->dynamic->AEGP_GetNewStreamRefByIndex(pluginId_, streamHandle(group), static_cast<A_long>(index0), &child),
       "AEGP_GetNewStreamRefByIndex");
  if (child == nullptr) throw HostFailure("stream child is missing", 0, "HOST_ERROR");
  return streamRef(child);
}

void AeReader::closeStream(StreamRef node) {
  ++calls_;
  s_->stream->AEGP_DisposeStream(streamHandle(node));
}

bool AeReader::isInactiveSeparationFollower(AEGP_StreamRefH stream) {
  A_Boolean follower = FALSE;
  if (!quiet(s_->dynamic->AEGP_IsSeparationFollower(stream, &follower), "AEGP_IsSeparationFollower") ||
      follower == FALSE)
    return false;
  AEGP_StreamRefH leader = nullptr;
  if (!soft(s_->dynamic->AEGP_GetSeparationLeader(stream, &leader), "AEGP_GetSeparationLeader") || leader == nullptr)
    return false;
  const ScopeGuard dispose([this, leader] { soft(s_->stream->AEGP_DisposeStream(leader), "AEGP_DisposeStream"); });
  A_Boolean separated = FALSE;
  const bool known = soft(s_->dynamic->AEGP_AreDimensionsSeparated(leader, &separated), "AEGP_AreDimensionsSeparated");
  return known && separated == FALSE;
}

NodeInfo AeReader::describe(StreamRef node) {
  AEGP_StreamRefH stream = streamHandle(node);
  NodeInfo info;
  std::array<char, 128> match{};
  if (soft(s_->dynamic->AEGP_GetMatchName(stream, match.data()), "AEGP_GetMatchName")) info.matchName = match.data();
  AEGP_MemHandle nameHandle = nullptr;
  if (soft(s_->stream->AEGP_GetStreamName(pluginId_, stream, FALSE, &nameHandle), "AEGP_GetStreamName"))
    info.displayName = takeText(nameHandle);
  AEGP_StreamGroupingType grouping = AEGP_StreamGroupingType_NONE;
  soft(s_->dynamic->AEGP_GetStreamGroupingType(stream, &grouping), "AEGP_GetStreamGroupingType");
  info.grouping = groupingOf(grouping);
  AEGP_DynStreamFlags flags = 0;
  if (soft(s_->dynamic->AEGP_GetDynamicStreamFlags(stream, &flags), "AEGP_GetDynamicStreamFlags")) {
    info.hidden = (flags & AEGP_DynStreamFlag_HIDDEN) != 0;
    info.enabled = enabledFromDynFlags(static_cast<int64_t>(flags));
    info.rawFlags = static_cast<int64_t>(flags);
  }
  if (info.grouping == Grouping::Leaf && !info.hidden && isInactiveSeparationFollower(stream)) info.hidden = true;
  return info;
}

namespace {

void copyNumericValue(AEGP_StreamType type, const AEGP_StreamValue2& value, ValueRead& out) {
  switch (type) {
    case AEGP_StreamType_OneD:
      out.kind = ValueRead::Kind::Number;
      out.v[0] = value.val.one_d;
      break;
    case AEGP_StreamType_TwoD:
    case AEGP_StreamType_TwoD_SPATIAL:
      out.kind = ValueRead::Kind::Vec2;
      out.v[0] = value.val.two_d.x;
      out.v[1] = value.val.two_d.y;
      break;
    case AEGP_StreamType_ThreeD:
    case AEGP_StreamType_ThreeD_SPATIAL:
      out.kind = ValueRead::Kind::Vec3;
      out.v[0] = value.val.three_d.x;
      out.v[1] = value.val.three_d.y;
      out.v[2] = value.val.three_d.z;
      break;
    case AEGP_StreamType_COLOR:
      out.kind = ValueRead::Kind::Color;
      out.v[0] = value.val.color.redF;
      out.v[1] = value.val.color.greenF;
      out.v[2] = value.val.color.blueF;
      out.v[3] = value.val.color.alphaF;
      break;
    default: break;
  }
}

}

bool AeReader::readNumericValue(AEGP_StreamRefH stream, AEGP_StreamType type, const ReadOptions& options,
                                ValueRead& out) {
  AEGP_StreamValue2 value;
  std::memset(&value, 0, sizeof value);
  if (!soft(s_->stream->AEGP_GetNewStreamValue(pluginId_, stream, AEGP_LTimeMode_CompTime, &compTime_,
                                               options.preExpression ? TRUE : FALSE, &value),
            "AEGP_GetNewStreamValue"))
    return false;
  const ScopeGuard dispose(
      [this, &value] { soft(s_->stream->AEGP_DisposeStreamValue(&value), "AEGP_DisposeStreamValue"); });
  copyNumericValue(type, value, out);
  return true;
}

void AeReader::readExpression(AEGP_StreamRefH stream, LeafInfo& leaf) {
  A_Boolean expressionOn = FALSE;
  if (!quiet(s_->stream->AEGP_GetExpressionState(pluginId_, stream, &expressionOn), "AEGP_GetExpressionState") ||
      expressionOn == FALSE)
    return;
  AEGP_MemHandle text = nullptr;
  if (!soft(s_->stream->AEGP_GetExpression(pluginId_, stream, &text), "AEGP_GetExpression")) return;
  leaf.expressionEnabled = true;
  leaf.expression = takeText(text, s_->expressionIsUtf16() ? TextEncoding::Utf16 : TextEncoding::EightBit);
}

LeafInfo AeReader::readLeaf(StreamRef node, const ReadOptions& options) {
  AEGP_StreamRefH stream = streamHandle(node);
  LeafInfo leaf;
  AEGP_StreamType type = AEGP_StreamType_NO_DATA;
  if (!soft(s_->stream->AEGP_GetStreamType(stream, &type), "AEGP_GetStreamType")) return leaf;
  leaf.type = valueTypeOf(type);
  if (const char* name = unsupportedName(leaf.type)) {
    leaf.value.kind = ValueRead::Kind::Unsupported;
    leaf.value.unsupported = name;
  } else if (leaf.type != ValueType::NoData) {
    readNumericValue(stream, type, options, leaf.value);
  }
  A_long keys = 0;
  if (quiet(s_->keyframe->AEGP_GetStreamNumKFs(stream, &keys), "AEGP_GetStreamNumKFs") && keys > 0) leaf.numKeys = keys;
  A_Boolean canVary = TRUE;
  if (quiet(s_->stream->AEGP_CanVaryOverTime(stream, &canVary), "AEGP_CanVaryOverTime"))
    leaf.animatable = canVary != FALSE;
  if (canVary != FALSE) readExpression(stream, leaf);
  return leaf;
}

}
