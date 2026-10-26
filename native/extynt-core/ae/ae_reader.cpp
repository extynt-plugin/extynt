// The AEGP host reader: layers, streams and effects read through the SDK suites into the core's value types.
#include "ae_reader.h"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <ratio>
#include <string>
#include <vector>

#include "A.h"
#include "AE_GeneralPlug.h"
#include "SPTypes.h"
#include "library_files.h"
#include "ae_log.h"
#include "ae_platform.h"
#include "ae_resources.h"
#include "sdk_bits.h"
#include "sdk_memory.h"
#include "host_reader.h"
#include "json_writer.h"
#include "text_decode.h"

namespace extynt::ae {

namespace {

constexpr size_t kMaxWarningKinds = 64;

std::string baseName(const std::string& path) {
  const size_t slash = path.find_last_of("/\\");
  return slash == std::string::npos ? path : path.substr(slash + 1);
}

AEGP_LayerH collectionItemLayer(const AEGP_CollectionItemV2& item) { return layerItem(item).layerH; }

std::string utf16Text(const MemoryLock& locked, size_t byteSize) {
  static_assert(sizeof(A_u_short) == sizeof(uint16_t), "AEGP UTF-16 text must be 16-bit code units");
  const A_u_short* units = locked.units();
  const size_t capacity = byteSize / sizeof(uint16_t);
  size_t length = 0;
  while (length < capacity && units[length] != 0) ++length;
  return utf16ToUtf8(units, length);
}

}

void AeReader::beginRequest() {
  calls_ = 0;
  softErrors_.clear();
  dropCaches();
}

void AeReader::invalidateCaches() { dropCaches(); }

void AeReader::beginQuietErrors() {
  if (quietActive_ || s_->utility == nullptr) return;
  quietState_ = AEGP_ErrReportState{};
  quietActive_ = s_->utility->AEGP_StartQuietErrors(&quietState_) == A_Err_NONE;
}

void AeReader::endQuietErrors() {
  if (!quietActive_) return;
  quietActive_ = false;
  s_->utility->AEGP_EndQuietErrors(FALSE, &quietState_);
}

void AeReader::dropCaches() {
  itemHandles_.clear();
  itemIds_.clear();
  itemsMapped_ = false;
  rootFolder_ = nullptr;
  comp_ = nullptr;
  selected_.clear();
  selectedOrdered_.clear();
  selectionLoaded_ = false;
}

void AeReader::requireSuites() {
  const std::string missing = s_->firstMissing();
  if (!missing.empty()) throw HostFailure("suite unavailable: " + missing + " (see ping.suites)", 0, "SUITE_MISSING");
}

void AeReader::hard(A_Err err, const char* what) {
  ++calls_;
  if (err != A_Err_NONE) throw HostFailure(std::string(what) + " failed (AEGP error " + std::to_string(err) + ")", err);
}

void AeReader::warn(const char* what, A_Err err) {
  if (softErrors_.size() >= kMaxWarningKinds && softErrors_.find(what) == softErrors_.end()) return;
  SoftError& entry = softErrors_[what];
  if (entry.count++ == 0) entry.first = err;
}

bool AeReader::soft(A_Err err, const char* what) {
  ++calls_;
  if (err == A_Err_NONE) return true;
  warn(what, err);
  return false;
}

bool AeReader::quiet(A_Err err, [[maybe_unused]] const char* what) {
  ++calls_;
  return err == A_Err_NONE;
}

std::vector<std::string> AeReader::takeWarnings() {
  std::vector<std::string> out;
  out.reserve(softErrors_.size());
  for (const auto& entry : softErrors_) {
    out.push_back(std::string("host-read-failed:") + entry.first + " x" + std::to_string(entry.second.count) +
                  " (first AEGP error " + std::to_string(entry.second.first) + ")");
  }
  return out;
}

double AeReader::seconds(const A_Time& time) {
  return time.scale == 0 ? 0.0 : static_cast<double>(time.value) / static_cast<double>(time.scale);
}

std::string AeReader::takeText(AEGP_MemHandle handle, TextEncoding encoding) {
  if (handle == nullptr) return "";
  const ScopeGuard freeHandle([this, handle] { soft(s_->memory->AEGP_FreeMemHandle(handle), "AEGP_FreeMemHandle"); });
  MemoryLock locked(*s_->memory, handle);
  if (!soft(locked.lockError(), "AEGP_LockMemHandle") || !locked.locked()) return "";
  AEGP_MemSize size = 0;
  soft(s_->memory->AEGP_GetMemHandleSize(handle, &size), "AEGP_GetMemHandleSize");
  const std::string text = encoding == TextEncoding::EightBit
                               ? decodeEightBitText(std::string_view(locked.chars(), static_cast<size_t>(size)))
                               : utf16Text(locked, static_cast<size_t>(size));
  soft(locked.unlock(), "AEGP_UnlockMemHandle");
  return text;
}

std::string AeReader::runScript(const char* script, double& micros, std::string& error) {
  AEGP_MemHandle result = nullptr;
  AEGP_MemHandle errorText = nullptr;
  A_Err err = A_Err_NONE;
  if (hostModalDialogOpen(*s_->utility)) {
    micros = 0;
    if (error.empty())
      error = std::string(kModalDialogErrorPrefix) + ": After Effects has a dialog open; close it and try again";
    return {};
  }
  const auto start = std::chrono::steady_clock::now();
  {
    const bool wasQuiet = quietActive_;
    endQuietErrors();
    const ScopeGuard requiet([this, wasQuiet] {
      if (wasQuiet) beginQuietErrors();
    });
    err = s_->utility->AEGP_ExecuteScript(pluginId_, script, FALSE, &result, &errorText);
  }
  micros = std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - start).count();
  const bool ok = soft(err, "AEGP_ExecuteScript");
  std::string text = takeText(result, TextEncoding::EightBit);
  const std::string reported = takeText(errorText, TextEncoding::EightBit);
  if (error.empty() && !reported.empty()) error = reported;
  if (error.empty() && !ok) error = "AEGP_ExecuteScript failed (AEGP error " + std::to_string(err) + ")";
  return text;
}

void AeReader::note(const std::string& line) { logLine(line); }

ScriptRun AeReader::executeFixedScript(const std::string& script) {
  requireSuites();
  ScriptRun run;
  run.result = runScript(script.c_str(), run.us, run.error);
  return run;
}

LibraryEntry AeReader::libraryEntry() { return findLibrary(defaultLibraryDirectories()); }

ScriptRevision AeReader::scriptRevision() {
  requireSuites();
  ScriptRevision cost;
  runScript("1", cost.floorUs, cost.error);
  cost.revisionRaw = runScript("app.project.revision", cost.revisionUs, cost.error);
  cost.revision = parseRevisionText(cost.revisionRaw);
  return cost;
}

AEGP_ProjectH AeReader::projectHandle() {
  requireSuites();
  A_long count = 0;
  hard(s_->project->AEGP_GetNumProjects(&count), "AEGP_GetNumProjects");
  if (count < 1) throw HostFailure("no project open", 0, "NO_PROJECT");
  AEGP_ProjectH project = nullptr;
  hard(s_->project->AEGP_GetProjectByIndex(0, &project), "AEGP_GetProjectByIndex");
  if (project == nullptr) throw HostFailure("no project open", 0, "NO_PROJECT");
  return project;
}

Id AeReader::itemId(AEGP_ItemH item) {
  auto cached = itemIds_.find(item);
  if (cached != itemIds_.end()) return cached->second;
  A_long id = 0;
  hard(s_->item->AEGP_GetItemID(item, &id), "AEGP_GetItemID");
  Id text = std::to_string(id);
  itemIds_[item] = text;
  return text;
}

ProjectInfo AeReader::project() {
  AEGP_ProjectH project = projectHandle();
  ProjectInfo info;
  AEGP_MemHandle pathHandle = nullptr;
  std::string path;
  if (soft(s_->project->AEGP_GetProjectPath(project, &pathHandle), "AEGP_GetProjectPath")) path = takeText(pathHandle);
  if (path.empty()) {
    info.name = "Untitled Project";
  } else {
    info.name = baseName(path);
    info.filePath = path;
  }
  A_Boolean dirty = FALSE;
  if (soft(s_->project->AEGP_ProjectIsDirty(project, &dirty), "AEGP_ProjectIsDirty")) info.dirty = dirty != FALSE;
  AEGP_ItemH active = nullptr;
  if (soft(s_->item->AEGP_GetActiveItem(&active), "AEGP_GetActiveItem") && active != nullptr) {
    AEGP_ItemType type = AEGP_ItemType_NONE;
    if (soft(s_->item->AEGP_GetItemType(active, &type), "AEGP_GetItemType") && type == AEGP_ItemType_COMP)
      info.activeCompId = itemId(active);
  }
  return info;
}

namespace {

ItemKind itemKindOf(AEGP_ItemType type) {
  if (type == AEGP_ItemType_FOLDER) return ItemKind::Folder;
  if (type == AEGP_ItemType_COMP) return ItemKind::Comp;
  if (type == AEGP_ItemType_FOOTAGE || type == AEGP_ItemType_SOLID_defunct) return ItemKind::Footage;
  return ItemKind::Other;
}

}

void AeReader::fillFootageDetails(AEGP_ItemH item, ItemRow& row) {
  AEGP_ItemFlags flags = 0;
  if (soft(s_->item->AEGP_GetItemFlags(item, &flags), "AEGP_GetItemFlags")) {
    row.missing = (flags & AEGP_ItemFlag_MISSING) != 0;
    row.still = (flags & AEGP_ItemFlag_STILL) != 0;
  }
  A_long width = 0;
  A_long height = 0;
  if (soft(s_->item->AEGP_GetItemDimensions(item, &width, &height), "AEGP_GetItemDimensions")) {
    row.width = width;
    row.height = height;
  }
  A_Time duration = {0, 1};
  if (soft(s_->item->AEGP_GetItemDuration(item, &duration), "AEGP_GetItemDuration")) row.duration = seconds(duration);
}

ItemRow AeReader::itemRow(AEGP_ItemH item) {
  ItemRow row;
  row.id = itemId(item);
  AEGP_ItemType type = AEGP_ItemType_NONE;
  soft(s_->item->AEGP_GetItemType(item, &type), "AEGP_GetItemType");
  row.kind = itemKindOf(type);
  AEGP_MemHandle nameHandle = nullptr;
  if (soft(s_->item->AEGP_GetItemName(pluginId_, item, &nameHandle), "AEGP_GetItemName"))
    row.name = takeText(nameHandle);
  AEGP_ItemH parent = nullptr;
  if (soft(s_->item->AEGP_GetItemParentFolder(item, &parent), "AEGP_GetItemParentFolder") && parent != nullptr)
    row.parentFolderId = itemId(parent);
  if (row.kind == ItemKind::Footage) fillFootageDetails(item, row);
  return row;
}

void AeReader::buildItemMap() {
  AEGP_ProjectH project = projectHandle();
  AEGP_ItemH root = nullptr;
  hard(s_->project->AEGP_GetProjectRootFolder(project, &root), "AEGP_GetProjectRootFolder");
  rootFolder_ = root;
  itemHandles_.clear();
  AEGP_ItemH item = nullptr;
  hard(s_->item->AEGP_GetFirstProjItem(project, &item), "AEGP_GetFirstProjItem");
  while (item != nullptr) {
    if (item != root) itemHandles_[itemId(item)] = item;
    AEGP_ItemH next = nullptr;
    hard(s_->item->AEGP_GetNextProjItem(project, item, &next), "AEGP_GetNextProjItem");
    item = next;
  }
  itemsMapped_ = true;
}

std::vector<ItemRow> AeReader::items() {
  AEGP_ProjectH project = projectHandle();
  AEGP_ItemH root = nullptr;
  hard(s_->project->AEGP_GetProjectRootFolder(project, &root), "AEGP_GetProjectRootFolder");
  rootFolder_ = root;
  itemHandles_.clear();
  std::vector<ItemRow> rows;
  AEGP_ItemH item = nullptr;
  hard(s_->item->AEGP_GetFirstProjItem(project, &item), "AEGP_GetFirstProjItem");
  while (item != nullptr) {
    if (item != root) {
      rows.push_back(itemRow(item));
      itemHandles_[rows.back().id] = item;
    }
    AEGP_ItemH next = nullptr;
    hard(s_->item->AEGP_GetNextProjItem(project, item, &next), "AEGP_GetNextProjItem");
    item = next;
  }
  itemsMapped_ = true;
  return rows;
}

void AeReader::fillCompGeometry(AEGP_ItemH item, CompRow& row) {
  A_long width = 0;
  A_long height = 0;
  if (soft(s_->item->AEGP_GetItemDimensions(item, &width, &height), "AEGP_GetItemDimensions")) {
    row.width = width;
    row.height = height;
  }
  A_Ratio aspect = {1, 1};
  if (soft(s_->item->AEGP_GetItemPixelAspectRatio(item, &aspect), "AEGP_GetItemPixelAspectRatio") && aspect.den != 0) {
    row.pixelAspect = static_cast<double>(aspect.num) / static_cast<double>(aspect.den);
  }
}

void AeReader::fillCompTiming(AEGP_ItemH item, CompRow& row) {
  A_Time time = {0, 1};
  if (soft(s_->item->AEGP_GetItemDuration(item, &time), "AEGP_GetItemDuration")) row.duration = seconds(time);
  A_FpLong frameRate = 0;
  if (soft(s_->comp->AEGP_GetCompFramerate(comp_, &frameRate), "AEGP_GetCompFramerate")) row.frameRate = frameRate;
  if (soft(s_->comp->AEGP_GetCompWorkAreaStart(comp_, &time), "AEGP_GetCompWorkAreaStart"))
    row.workAreaStart = seconds(time);
  if (soft(s_->comp->AEGP_GetCompWorkAreaDuration(comp_, &time), "AEGP_GetCompWorkAreaDuration"))
    row.workAreaDuration = seconds(time);
  compTime_ = {0, 1};
  if (soft(s_->item->AEGP_GetItemCurrentTime(item, &time), "AEGP_GetItemCurrentTime")) {
    compTime_ = time;
    row.currentTime = seconds(time);
  }
}

bool AeReader::openComp(const Id& compId, CompRow& out) {
  requireSuites();
  if (!itemsMapped_) buildItemMap();
  const auto found = itemHandles_.find(compId);
  if (found == itemHandles_.end()) return false;
  AEGP_ItemH item = found->second;
  AEGP_ItemType type = AEGP_ItemType_NONE;
  hard(s_->item->AEGP_GetItemType(item, &type), "AEGP_GetItemType");
  if (type != AEGP_ItemType_COMP) return false;
  hard(s_->comp->AEGP_GetCompFromItem(item, &comp_), "AEGP_GetCompFromItem");
  selectionLoaded_ = false;
  selected_.clear();
  selectedOrdered_.clear();

  CompRow row;
  row.id = compId;
  AEGP_MemHandle nameHandle = nullptr;
  if (soft(s_->item->AEGP_GetItemName(pluginId_, item, &nameHandle), "AEGP_GetItemName"))
    row.name = takeText(nameHandle);
  AEGP_ColorVal background = {1, 0, 0, 0};
  if (soft(s_->comp->AEGP_GetCompBGColor(comp_, &background), "AEGP_GetCompBGColor")) {
    row.backgroundColor[0] = background.redF;
    row.backgroundColor[1] = background.greenF;
    row.backgroundColor[2] = background.blueF;
  }
  fillCompGeometry(item, row);
  fillCompTiming(item, row);
  A_long layers = 0;
  hard(s_->layer->AEGP_GetCompNumLayers(comp_, &layers), "AEGP_GetCompNumLayers");
  row.numLayers = layers;
  out = row;
  return true;
}

Id AeReader::layerIdOf(AEGP_LayerH layer) {
  AEGP_LayerIDVal id = 0;
  hard(s_->layer->AEGP_GetLayerID(layer, &id), "AEGP_GetLayerID");
  return std::to_string(id);
}

void AeReader::collectSelectedLayers(AEGP_Collection2H collection, A_u_long count) {
  for (A_u_long i = 0; i < count; ++i) {
    AEGP_CollectionItemV2 item;
    std::memset(&item, 0, sizeof item);
    if (!soft(s_->collection->AEGP_GetCollectionItemByIndex(collection, i, &item), "AEGP_GetCollectionItemByIndex"))
      continue;
    if (item.type != AEGP_CollectionItemType_LAYER) continue;
    AEGP_LayerH layer = collectionItemLayer(item);
    if (layer == nullptr) continue;
    AEGP_LayerIDVal id = 0;
    if (!soft(s_->layer->AEGP_GetLayerID(layer, &id), "AEGP_GetLayerID")) continue;
    selected_.insert(std::to_string(id));
    selectedOrdered_.push_back(std::to_string(id));
  }
}

void AeReader::loadSelection() {
  if (selectionLoaded_) return;
  selectionLoaded_ = true;
  AEGP_Collection2H collection = nullptr;
  if (!soft(s_->comp->AEGP_GetNewCollectionFromCompSelection(pluginId_, comp_, &collection),
            "AEGP_GetNewCollectionFromCompSelection") ||
      collection == nullptr)
    return;
  const ScopeGuard dispose(
      [this, collection] { soft(s_->collection->AEGP_DisposeCollection(collection), "AEGP_DisposeCollection"); });
  A_u_long count = 0;
  if (soft(s_->collection->AEGP_GetCollectionNumItems(collection, &count), "AEGP_GetCollectionNumItems"))
    collectSelectedLayers(collection, count);
}

std::vector<Id> AeReader::selectedLayerIds() {
  loadSelection();
  return selectedOrdered_;
}

}
