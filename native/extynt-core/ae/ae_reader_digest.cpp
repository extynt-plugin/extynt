// Content digests for the walker's row hashes. A row's JSON carries a keyed property's key COUNT and the value types
// the detail reads (text document, marker, path, layer reference) only by name, so the digest here folds what the jsx
// details call reads: every key's time, value, interpolation, temporal ease, spatial tangents and flags, the text of a
// document, a marker's strings, duration, label and flags, a path's vertices and tangents, and the index a layer
// reference points at. Every getter is "quiet" (counted, never reported): a field that cannot be read folds as a flag,
// so the digest stays deterministic and the walk's warnings stay what they were.
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>

#include "A.h"
#include "AE_GeneralPlug.h"
#include "SPTypes.h"
#include "ae_reader.h"
#include "sdk_ref.h"
#include "ae_resources.h"
#include "sdk_memory.h"
#include "digest_sink.h"
#include "hash128.h"
#include "host_reader.h"

namespace extynt::ae {

namespace {

constexpr A_long kMaxDigestKeys = 1024;
constexpr A_long kMaxDigestVertices = 1001;
constexpr uint32_t kNoText = 0xFFFFFFFFU;

constexpr std::array<AEGP_MarkerStringType, 5> kMarkerStrings = {AEGP_MarkerString_COMMENT, AEGP_MarkerString_CHAPTER,
                                                                 AEGP_MarkerString_URL, AEGP_MarkerString_FRAME_TARGET,
                                                                 AEGP_MarkerString_CUE_POINT_NAME};

static_assert(sizeof(AEGP_MaskVertex) == 6 * sizeof(double), "a path vertex is six doubles with no padding");

bool isSpatial(ValueType type) { return type == ValueType::TwoDSpatial || type == ValueType::ThreeDSpatial; }

bool isNumeric(ValueType type) {
  return type == ValueType::OneD || type == ValueType::TwoD || type == ValueType::TwoDSpatial ||
         type == ValueType::ThreeD || type == ValueType::ThreeDSpatial || type == ValueType::Color;
}

bool hasEase(ValueType type) { return isNumeric(type) || type == ValueType::Mask; }

void putNumericValue(DigestSink& sink, ValueType type, const AEGP_StreamValue2& value) {
  switch (type) {
    case ValueType::OneD: sink.put(value.val.one_d); break;
    case ValueType::TwoD:
    case ValueType::TwoDSpatial:
      sink.put(value.val.two_d.x);
      sink.put(value.val.two_d.y);
      break;
    case ValueType::ThreeD:
    case ValueType::ThreeDSpatial:
      sink.put(value.val.three_d.x);
      sink.put(value.val.three_d.y);
      sink.put(value.val.three_d.z);
      break;
    case ValueType::Color:
      sink.put(value.val.color.redF);
      sink.put(value.val.color.greenF);
      sink.put(value.val.color.blueF);
      sink.put(value.val.color.alphaF);
      break;
    default: break;
  }
}

}

bool AeReader::streamContentDigest(StreamRef node, const LeafInfo& leaf, Hasher& into) {
  DigestSink sink(into);
  DigestSite site;
  site.stream = streamHandle(node);
  site.type = leaf.type;
  site.sink = &sink;
  sink.put(leaf.type);
  sink.put(leaf.numKeys);
  if (leaf.numKeys > 0) digestKeys(site, static_cast<A_long>(leaf.numKeys));
  digestCurrentValue(site);
  return true;
}

void AeReader::digestKeys(DigestSite& site, A_long count) {
  A_short dims = 0;
  if (!hasEase(site.type) || !quiet(s_->keyframe->AEGP_GetStreamTemporalDimensionality(site.stream, &dims), "dims"))
    dims = 0;
  site.temporalDims = dims;
  site.sink->put(dims);
  const A_long limit = std::min(count, kMaxDigestKeys);
  for (A_long index = 0; index < limit; ++index) digestKey(site, index);
}

void AeReader::digestKey(const DigestSite& site, A_long index) {
  A_Time time = {0, 1};
  AEGP_KeyframeFlags flags = 0;
  AEGP_KeyframeInterpolationType inInterp = 0;
  AEGP_KeyframeInterpolationType outInterp = 0;
  uint32_t unread = 0;
  if (!quiet(s_->keyframe->AEGP_GetKeyframeTime(site.stream, index, AEGP_LTimeMode_CompTime, &time), "time"))
    unread |= 1U;
  const bool eased = hasEase(site.type);
  if (eased && !quiet(s_->keyframe->AEGP_GetKeyframeFlags(site.stream, index, &flags), "flags")) unread |= 2U;
  if (eased && !quiet(s_->keyframe->AEGP_GetKeyframeInterpolation(site.stream, index, &inInterp, &outInterp), "interp"))
    unread |= 4U;
  DigestSink& sink = *site.sink;
  sink.put(time.value);
  sink.put(time.scale);
  sink.put(flags);
  sink.put(inInterp);
  sink.put(outInterp);
  sink.put(unread);
  digestKeyValue(site, index);
  if (eased) digestKeyEase(site, index);
  if (isSpatial(site.type)) digestKeyTangents(site, index);
}

void AeReader::digestKeyEase(const DigestSite& site, A_long index) {
  for (A_short dim = 0; dim < site.temporalDims; ++dim) {
    AEGP_KeyframeEase in = {0, 0};
    AEGP_KeyframeEase out = {0, 0};
    site.sink->put(quiet(s_->keyframe->AEGP_GetKeyframeTemporalEase(site.stream, index, dim, &in, &out), "ease"));
    site.sink->put(in);
    site.sink->put(out);
  }
}

void AeReader::digestKeyTangents(const DigestSite& site, A_long index) {
  AEGP_StreamValue2 in;
  AEGP_StreamValue2 out;
  std::memset(&in, 0, sizeof in);
  std::memset(&out, 0, sizeof out);
  const bool read =
      quiet(s_->keyframe->AEGP_GetNewKeyframeSpatialTangents(pluginId_, site.stream, index, &in, &out), "tangents");
  site.sink->put(read);
  if (!read) return;
  const ScopeGuard disposeIn(
      [this, &in] { soft(s_->stream->AEGP_DisposeStreamValue(&in), "AEGP_DisposeStreamValue"); });
  const ScopeGuard disposeOut(
      [this, &out] { soft(s_->stream->AEGP_DisposeStreamValue(&out), "AEGP_DisposeStreamValue"); });
  putNumericValue(*site.sink, site.type, in);
  putNumericValue(*site.sink, site.type, out);
}

void AeReader::digestKeyValue(const DigestSite& site, A_long index) {
  AEGP_StreamValue2 value;
  std::memset(&value, 0, sizeof value);
  const bool read = quiet(s_->keyframe->AEGP_GetNewKeyframeValue(pluginId_, site.stream, index, &value), "value");
  site.sink->put(read);
  if (!read) return;
  const ScopeGuard dispose(
      [this, &value] { soft(s_->stream->AEGP_DisposeStreamValue(&value), "AEGP_DisposeStreamValue"); });
  digestStreamValue(site, value);
}

void AeReader::digestCurrentValue(const DigestSite& site) {
  if (site.type != ValueType::TextDocument && site.type != ValueType::Mask && site.type != ValueType::LayerId) return;
  AEGP_StreamValue2 value;
  std::memset(&value, 0, sizeof value);
  const bool read = quiet(
      s_->stream->AEGP_GetNewStreamValue(pluginId_, site.stream, AEGP_LTimeMode_CompTime, &compTime_, FALSE, &value),
      "current");
  site.sink->put(read);
  if (!read) return;
  const ScopeGuard dispose(
      [this, &value] { soft(s_->stream->AEGP_DisposeStreamValue(&value), "AEGP_DisposeStreamValue"); });
  digestStreamValue(site, value);
}

void AeReader::digestStreamValue(const DigestSite& site, const AEGP_StreamValue2& value) {
  DigestSink& sink = *site.sink;
  switch (site.type) {
    case ValueType::TextDocument: digestTextDocument(sink, value.val.text_documentH); break;
    case ValueType::Mask: digestOutline(sink, value.val.mask); break;
    case ValueType::Marker: digestMarker(sink, value.val.markerP); break;
    case ValueType::LayerId: digestLayerReference(sink, value.val.layer_id); break;
    default: putNumericValue(sink, site.type, value); break;
  }
}

void AeReader::digestMemText(DigestSink& sink, AEGP_MemHandle handle) {
  if (handle == nullptr) {
    sink.put(kNoText);
    return;
  }
  const ScopeGuard freeHandle([this, handle] { soft(s_->memory->AEGP_FreeMemHandle(handle), "AEGP_FreeMemHandle"); });
  MemoryLock locked(*s_->memory, handle);
  if (!quiet(locked.lockError(), "lock") || !locked.locked()) {
    sink.put(kNoText);
    return;
  }
  AEGP_MemSize size = 0;
  quiet(s_->memory->AEGP_GetMemHandleSize(handle, &size), "size");
  const A_u_short* units = locked.units();
  const size_t capacity = static_cast<size_t>(size) / sizeof(A_u_short);
  size_t length = 0;
  while (length < capacity && units[length] != 0) ++length;
  sink.put(static_cast<uint32_t>(length));
  sink.putArray(units, length);
  soft(locked.unlock(), "AEGP_UnlockMemHandle");
}

void AeReader::digestTextDocument(DigestSink& sink, AEGP_TextDocumentH document) {
  AEGP_MemHandle text = nullptr;
  const bool read = document != nullptr && quiet(s_->textDocument->AEGP_GetNewText(pluginId_, document, &text), "text");
  sink.put(read);
  if (read) digestMemText(sink, text);
}

void AeReader::digestOutline(DigestSink& sink, AEGP_MaskOutlineValH outline) {
  A_Boolean open = FALSE;
  A_long segments = 0;
  const bool read = outline != nullptr && quiet(s_->maskOutline->AEGP_IsMaskOutlineOpen(outline, &open), "open") &&
                    quiet(s_->maskOutline->AEGP_GetMaskOutlineNumSegments(outline, &segments), "segments");
  sink.put(read);
  if (!read) return;
  sink.put(open != FALSE);
  sink.put(segments);
  const A_long vertices = std::min(segments + (open != FALSE ? 1 : 0), kMaxDigestVertices);
  for (A_long index = 0; index < vertices; ++index) {
    AEGP_MaskVertex vertex = {};
    sink.put(quiet(s_->maskOutline->AEGP_GetMaskOutlineVertexInfo(outline, index, &vertex), "vertex"));
    sink.put(vertex);
  }
}

void AeReader::digestMarker(DigestSink& sink, AEGP_MarkerValP marker) {
  sink.put(marker != nullptr);
  if (marker == nullptr) return;
  for (const AEGP_MarkerStringType kind : kMarkerStrings) {
    AEGP_MemHandle text = nullptr;
    const bool read = quiet(s_->marker->AEGP_GetMarkerString(pluginId_, marker, kind, &text), "markerString");
    if (read) {
      digestMemText(sink, text);
    } else {
      sink.put(kNoText);
    }
  }
  A_Time duration = {0, 1};
  A_long label = 0;
  A_Boolean navigation = FALSE;
  A_Boolean protectedRegion = FALSE;
  sink.put(quiet(s_->marker->AEGP_GetMarkerDuration(marker, &duration), "markerDuration"));
  sink.put(quiet(s_->marker->AEGP_GetMarkerLabel(marker, &label), "markerLabel"));
  quiet(s_->marker->AEGP_GetMarkerFlag(marker, AEGP_MarkerFlag_NAVIGATION, &navigation), "markerFlag");
  quiet(s_->marker->AEGP_GetMarkerFlag(marker, AEGP_MarkerFlag_PROTECT_REGION, &protectedRegion), "markerFlag");
  sink.put(duration.value);
  sink.put(duration.scale);
  sink.put(label);
  sink.put(navigation != FALSE);
  sink.put(protectedRegion != FALSE);
}

void AeReader::digestLayerReference(DigestSink& sink, AEGP_LayerIDVal id) {
  sink.put(id);
  A_long index = -1;
  AEGP_LayerH layer = nullptr;
  if (id != AEGP_LayerIDVal_NONE && comp_ != nullptr &&
      quiet(s_->layer->AEGP_GetLayerFromLayerID(comp_, id, &layer), "layerFromId") && layer != nullptr)
    quiet(s_->layer->AEGP_GetLayerIndex(layer, &index), "layerIndex");
  sink.put(index);
}

}
