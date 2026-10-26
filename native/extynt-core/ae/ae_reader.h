// HostReader backed by AEGP suites. Reads call Get*/Is*/Dispose*/Free*/Lock/Unlock only; the one write path is
// AEGP_ExecuteScript with a script core/write_ops.cpp built from a fixed template. Main thread only (AEGP rule);
// the idle hook is the sole caller.
#pragma once

#include <cstdint>
#include <optional>
#include <set>
#include <string>
#include <unordered_map>
#include <vector>

#include "ae_resources.h"
#include "sdk_ref.h"
#include "ae_sdk.h"
#include "ae_suites.h"
#include "digest_sink.h"
#include "hash128.h"
#include "host_reader.h"
#include "options_dialog_index.h"

namespace extynt::ae {

class AeReader : public HostReader {
 public:
  AeReader(const Suites& suites, AEGP_PluginID pluginId) : s_(&suites), pluginId_(pluginId) {}

  void note(const std::string& line) override;
  void beginRequest() override;
  [[nodiscard]] uint64_t getterCalls() const override { return calls_; }
  std::vector<std::string> takeWarnings() override;

  ProjectInfo project() override;
  std::vector<ItemRow> items() override;
  bool openComp(const Id& compId, CompRow& out) override;
  std::vector<Id> selectedLayerIds() override;

  LayerRef layerAt(int64_t index1, LayerRow& out) override;
  bool layerById(const Id& layerId, LayerRef& ref, LayerRow& out) override;

  StreamRef openLayerRoot(LayerRef layer) override;
  int64_t childCount(StreamRef group) override;
  StreamRef childAt(StreamRef group, int64_t index0) override;
  int64_t firstChildIndex(StreamRef group, bool groupIsEffect) override;
  NodeInfo describe(StreamRef node) override;
  LeafInfo readLeaf(StreamRef node, const ReadOptions& options) override;
  bool streamContentDigest(StreamRef node, const LeafInfo& leaf, Hasher& into) override;
  void closeStream(StreamRef node) override;
  ScriptRevision scriptRevision() override;
  [[nodiscard]] bool revisionGuard() const override { return revisionGuard_; }
  void setRevisionGuard(bool on) { revisionGuard_ = on; }
  ScriptRun executeFixedScript(const std::string& script) override;
  LibraryEntry libraryEntry() override;
  std::vector<EffectPopups> layerEffectPopups(LayerRef layer) override;
  void invalidateCaches() override;

  // The census's Options-dialog flags (transport/options_dialog_index.h); the index outlives the reader.
  void setOptionsDialogIndex(const OptionsDialogIndex* index) { dialogIndex_ = index; }
  std::optional<std::vector<EffectDialogFlag>> effectDialogFlags() override {
    return dialogIndex_ != nullptr ? dialogIndex_->snapshot() : std::nullopt;
  }
  bool effectDialogScanPending() override { return dialogIndex_ != nullptr && dialogIndex_->pending(); }

  // AE's modal error dialogs are suppressed for native reads (a failing read is an ordinary answer). Main thread only.
  // AEGP_ExecuteScript lifts the suppression for the length of the call (runScript), so a script sees an AE error as
  // an exception, as under DoScript, and its try/catch probes work.
  void beginQuietErrors();
  void endQuietErrors();

 private:
  bool revisionGuard_ = true;
  const OptionsDialogIndex* dialogIndex_ = nullptr;
  // What an AEGP memory handle holds. Every text call this adapter makes returns UTF-16 (checked against the
  // header of the suite version acquired) except StreamSuite4's AEGP_GetExpression and AEGP_ExecuteScript
  // results, which are 8-bit (UTF-8, or the platform's Latin-1-like encoding when the bytes are not UTF-8).
  enum class TextEncoding : uint8_t { Utf16, EightBit };

  // --- call bookkeeping -------------------------------------------------------------
  // Hard failure: the request cannot continue. Soft failure: note it, use a default, go on.
  void hard(A_Err err, const char* what);
  bool soft(A_Err err, const char* what);
  bool quiet(A_Err err, const char* what);
  void warn(const char* what, A_Err err);
  void requireSuites();
  void dropCaches();

  // --- helpers ----------------------------------------------------------------------
  std::string takeText(AEGP_MemHandle handle, TextEncoding encoding = TextEncoding::Utf16);
  std::string runScript(const char* script, double& micros, std::string& error);
  AEGP_ProjectH projectHandle();
  void buildItemMap();
  ItemRow itemRow(AEGP_ItemH item);
  void fillFootageDetails(AEGP_ItemH item, ItemRow& row);
  void fillCompGeometry(AEGP_ItemH item, CompRow& row);
  void fillCompTiming(AEGP_ItemH item, CompRow& row);
  LayerRow layerRow(AEGP_LayerH layer);
  void fillLayerTiming(AEGP_LayerH layer, LayerRow& row);
  void fillLayerRelations(AEGP_LayerH layer, LayerRow& row);
  void fillLayerMatte(AEGP_LayerH layer, LayerRow& row);
  void fillLayerRendering(AEGP_LayerH layer, LayerRow& row);
  void fillLayerSampling(AEGP_LayerH layer, LayerRow& row);
  void fillLayerSwitches(AEGP_LayerH layer, AEGP_LayerFlags flags, LayerRow& row);
  void loadSelection();
  void collectSelectedLayers(AEGP_Collection2H collection, A_u_long count);
  Id layerIdOf(AEGP_LayerH layer);
  Id itemId(AEGP_ItemH item);
  void readExpression(AEGP_StreamRefH stream, LeafInfo& leaf);
  bool readNumericValue(AEGP_StreamRefH stream, AEGP_StreamType type, const ReadOptions& options, ValueRead& out);
  bool isInactiveSeparationFollower(AEGP_StreamRefH stream);
  static double seconds(const A_Time& time);

  // --- popup menus (ae_reader_effect.cpp) ----------------------------------------------------------------------------
  EffectPopups readEffectPopups(AEGP_EffectRefH effect);
  bool readPopupParam(AEGP_EffectRefH effect, A_long paramIndex, PopupParam& out);
  std::string effectParamMatchName(AEGP_EffectRefH effect, A_long paramIndex);

  // --- content digests (ae_reader_digest.cpp): what the detail reads depend on, folded into a row hash ------------
  struct DigestSite {
    AEGP_StreamRefH stream = nullptr;
    ValueType type = ValueType::NoData;
    DigestSink* sink = nullptr;
    A_short temporalDims = 0;
  };
  void digestKeys(DigestSite& site, A_long count);
  void digestKey(const DigestSite& site, A_long index);
  void digestKeyEase(const DigestSite& site, A_long index);
  void digestKeyTangents(const DigestSite& site, A_long index);
  void digestKeyValue(const DigestSite& site, A_long index);
  void digestCurrentValue(const DigestSite& site);
  void digestStreamValue(const DigestSite& site, const AEGP_StreamValue2& value);
  void digestMemText(DigestSink& sink, AEGP_MemHandle handle);
  void digestTextDocument(DigestSink& sink, AEGP_TextDocumentH document);
  void digestOutline(DigestSink& sink, AEGP_MaskOutlineValH outline);
  void digestMarker(DigestSink& sink, AEGP_MarkerValP marker);
  void digestLayerReference(DigestSink& sink, AEGP_LayerIDVal id);

  const Suites* s_;
  AEGP_PluginID pluginId_;
  uint64_t calls_ = 0;
  AEGP_ErrReportState quietState_{};
  bool quietActive_ = false;
  struct SoftError {
    int count = 0;
    A_Err first = 0;
  };
  std::unordered_map<std::string, SoftError> softErrors_;
  std::unordered_map<AEGP_ItemH, Id> itemIds_;

  std::unordered_map<std::string, AEGP_ItemH> itemHandles_;
  bool itemsMapped_ = false;
  AEGP_ItemH rootFolder_ = nullptr;

  AEGP_CompH comp_ = nullptr;
  A_Time compTime_ = {0, 1};
  std::set<Id> selected_;
  std::vector<Id> selectedOrdered_;
  bool selectionLoaded_ = false;
};

}
