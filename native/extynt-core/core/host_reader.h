// The seam between the pure walk and the host. The AE adapter implements this
// with AEGP suites; the unit tests implement it with an in-memory fake scene.
// No SDK includes here. All methods run on the host's main thread.
#pragma once

#include <array>
#include <cstdint>
#include <functional>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

#include "hash128.h"
#include "options_dialogs.h"

namespace extynt {

// Item and layer ids as decimal text, the form the protocol carries.
using Id = std::string;

// What a LayerRef points at. Only the host reader that made the reference completes the type; nothing else looks
// inside.
struct LayerToken;

// What a StreamRef points at; completed only by the host reader that made the reference.
struct StreamToken;

// Names a layer of the current comp for the host reader. Opaque, and valid only inside one request.
struct LayerRef {
  LayerToken* value = nullptr;
  friend bool operator==(LayerRef a, LayerRef b) { return a.value == b.value; }
  friend bool operator<(LayerRef a, LayerRef b) { return std::less<>()(a.value, b.value); }
};

// Names an open property stream. Opaque, and must be released with HostReader::closeStream.
struct StreamRef {
  StreamToken* value = nullptr;
  friend bool operator==(StreamRef a, StreamRef b) { return a.value == b.value; }
  friend bool operator<(StreamRef a, StreamRef b) { return std::less<>()(a.value, b.value); }
};

// What a failed host_call knows about its own cost, so the failure response keeps the fields a success carries.
struct FailureTiming {
  double scriptUs = 0;
  bool libraryLoaded = false;
  double libraryLoadUs = 0;
};

class HostFailure : public std::runtime_error {
 public:
  HostFailure(const std::string& what, int hostCode = 0, std::string code = "HOST_ERROR")
      : std::runtime_error(what), hostCode_(hostCode), code_(std::move(code)) {}
  [[nodiscard]] int hostCode() const { return hostCode_; }
  [[nodiscard]] const std::string& code() const { return code_; }
  [[nodiscard]] const std::optional<FailureTiming>& timing() const { return timing_; }
  [[nodiscard]] HostFailure withTiming(const FailureTiming& timing) const {
    HostFailure copy = *this;
    copy.timing_ = timing;
    return copy;
  }

 private:
  int hostCode_;
  std::string code_;
  std::optional<FailureTiming> timing_;
};

// The kind of a layer as the DOM names it (the protocol spells them in lower case, see layerTypeName).
enum class LayerType : uint8_t { Text, Shape, Camera, Light, Null, Adjustment, Av };

// How a layer is matted by the layer above it (the protocol spells them in lower case, see matteTypeName).
enum class MatteType : uint8_t { None, Alpha, AlphaInverted, Luma, LumaInverted };

enum class ItemKind : uint8_t { Folder, Comp, Footage, Other };

struct ProjectInfo {
  std::string name;
  std::optional<std::string> filePath;
  bool dirty = false;
  std::optional<Id> activeCompId;
};

struct ItemRow {
  Id id;
  std::string name;
  ItemKind kind = ItemKind::Other;
  std::optional<Id> parentFolderId;
  // footage only
  bool missing = false;
  bool still = false;
  int64_t width = 0;
  int64_t height = 0;
  double duration = 0;
};

struct CompRow {
  Id id;
  std::string name;
  std::array<double, 3> backgroundColor = {0, 0, 0};
  int64_t width = 0;
  int64_t height = 0;
  double pixelAspect = 1;
  double duration = 0;
  double frameRate = 0;
  double workAreaStart = 0;
  double workAreaDuration = 0;
  double currentTime = 0;
  int64_t numLayers = 0;
};

struct LayerSwitches {
  std::optional<std::string> blendMode;
  std::optional<bool> motionBlur;
  std::optional<bool> collapseTransformation;
  std::optional<bool> guideLayer;
  std::optional<bool> adjustment;
  std::optional<bool> effectsActive;
  std::optional<std::string> quality;
  std::optional<std::string> sampling;
  std::optional<std::string> frameBlending;
};

struct LayerRow {
  Id id;
  // 1-based, as layer.index
  int64_t index = 0;
  std::string name;
  bool selected = false;
  int64_t label = 0;
  LayerType type = LayerType::Av;
  bool enabled = false;
  bool shy = false;
  bool solo = false;
  bool locked = false;
  bool threeD = false;
  std::optional<bool> audioEnabled;
  double startTime = 0;
  double inPoint = 0;
  double outPoint = 0;
  // Time stretch in percent; 100 is unstretched.
  double stretchPercent = 100;
  std::optional<Id> parentId;
  std::optional<Id> matteLayerId;
  MatteType matteType = MatteType::None;
  std::optional<Id> sourceId;
  std::optional<Id> compositionSourceId;
  LayerSwitches switches;
};

enum class Grouping : uint8_t { Leaf, Named, Indexed };

enum class ValueType : uint8_t {
  NoData,
  OneD,
  TwoD,
  TwoDSpatial,
  ThreeD,
  ThreeDSpatial,
  Color,
  Arb,
  Marker,
  LayerId,
  MaskId,
  Mask,
  TextDocument
};

// One node of a layer's property tree, without its value.
struct NodeInfo {
  std::string matchName;
  std::string displayName;
  Grouping grouping = Grouping::Leaf;
  bool hidden = false;
  // On/off state when the node has one (the DOM's PropertyBase.enabled)
  std::optional<bool> enabled;
  // The host's own flag word, reported only when a request asks (debugFlags)
  int64_t rawFlags = 0;
};

struct ValueRead {
  enum class Kind : uint8_t { None, Number, Vec2, Vec3, Color, Unsupported };
  Kind kind = Kind::None;
  std::array<double, 4> v = {0, 0, 0, 0};
  // Type name when kind == Unsupported
  std::string unsupported;
};

struct LeafInfo {
  ValueType type = ValueType::NoData;
  ValueRead value;
  int64_t numKeys = 0;
  bool animatable = true;
  bool expressionEnabled = false;
  // Only filled when expressionEnabled
  std::string expression;
};

struct ReadOptions {
  bool preExpression = false;
};

// What ExtendScript costs when run from the plugin (AEGP_ExecuteScript): the revision counter of the
// open project and the time spent, against a trivial script as the floor. Read-only fixed scripts.
struct ScriptRevision {
  // App.project.revision, when the result parsed as an integer
  std::optional<int64_t> revision;
  // The result text as AE returned it
  std::string revisionRaw;
  // Microseconds inside ExecuteScript for `app.project.revision`
  double revisionUs = 0;
  // Microseconds inside ExecuteScript for `1`
  double floorUs = 0;
  // The first script error text, empty when both scripts ran clean
  std::string error;
};

// One script run through the host (AEGP_ExecuteScript): its result text, the microseconds spent inside the call and the
// first error text. Only core/write_ops.cpp builds the scripts; nothing a socket client sends becomes script text.
struct ScriptRun {
  std::string result;
  double us = 0;
  // Empty when the call and the script ran clean
  std::string error;
};

// The start of the error text a script run carries when it was refused because After Effects has a modal dialog open
// (set by the AE reader, matched by host_call). Nothing ran.
inline constexpr const char* kModalDialogErrorPrefix = "AE_MODAL_DIALOG";

// Where the host jsx library is (host_call). Resolved by the plugin, never passed in.
struct LibraryEntry {
  // Absolute path of the library's entry file, empty when not found
  std::string entryFile;
  std::string extensionDir;
  // What was looked at, or why nothing was found
  std::string note;
  // The manifest's version (docs/native/protocol.md); empty when the library has no manifest
  std::string version;
};

// One popup parameter as the host reports it: the parameter stream's matchName, the raw '|'-separated item text and
// the count of choices the host states for it (core/effect_menus.h splits the text).
struct PopupParam {
  std::string matchName;
  std::string names;
  int64_t numChoices = 0;
};

// The popup parameters of one effect on a layer, in parameter order.
struct EffectPopups {
  // The effect's installed match name
  std::string matchName;
  std::vector<PopupParam> popups;
};

class HostReader {
 public:
  virtual ~HostReader() = default;
  HostReader& operator=(const HostReader&) = delete;
  HostReader& operator=(HostReader&&) = delete;

  // One line for the plugin's own log; the default drops it.
  virtual void note(const std::string& line) { (void)line; }

  // Called once at the start of every request: drop caches, reset counters.
  virtual void beginRequest() = 0;
  // Host calls made since beginRequest (AEGP suite calls for the real adapter).
  [[nodiscard]] virtual uint64_t getterCalls() const = 0;
  // Soft failures (a value that could not be read) collected since beginRequest.
  virtual std::vector<std::string> takeWarnings() = 0;

  // Throws HostFailure("NO_PROJECT") when none is open
  virtual ProjectInfo project() = 0;
  // Every project item, project order, root folder excluded
  virtual std::vector<ItemRow> items() = 0;
  // Makes it the current comp; false when not a comp
  virtual bool openComp(const Id& compId, CompRow& out) = 0;
  // Of the current comp
  virtual std::vector<Id> selectedLayerIds() = 0;

  // Current comp
  virtual LayerRef layerAt(int64_t index1, LayerRow& out) = 0;
  // Current comp
  virtual bool layerById(const Id& layerId, LayerRef& ref, LayerRow& out) = 0;

  virtual StreamRef openLayerRoot(LayerRef layer) = 0;
  virtual int64_t childCount(StreamRef group) = 0;
  virtual StreamRef childAt(StreamRef group, int64_t index0) = 0;
  // The first child index the host's DOM shows. After Effects' dynamic streams list an effect's input
  // layer as child 0 (matchName "<effect>-0000") and the DOM starts at parameter 1: an adapter returns 1
  // for a group that is an effect (a direct child of the Effect Parade), 0 for everything else.
  virtual int64_t firstChildIndex([[maybe_unused]] StreamRef group, [[maybe_unused]] bool groupIsEffect) { return 0; }
  virtual NodeInfo describe(StreamRef node) = 0;
  virtual LeafInfo readLeaf(StreamRef node, const ReadOptions& options) = 0;
  // Folds into `into` what the detail reads of this leaf depend on and its row does not carry: every key (time, value,
  // easing, tangents, flags), a text document's text, a marker's fields, a path's vertices, a layer reference's target.
  // The walker asks only while hashing, and only for a keyed leaf or one of those value types. False: nothing folded.
  virtual bool streamContentDigest([[maybe_unused]] StreamRef node, [[maybe_unused]] const LeafInfo& leaf,
                                   [[maybe_unused]] Hasher& into) {
    return false;
  }
  virtual void closeStream(StreamRef node) = 0;

  // Whether `app.project.revision` may be read on this host. Off only where the real host's revision was found
  // unreliable (core/host_version.cpp, kRevisionGuardMinMajor); every stamp then carries no revision and the sidecar
  // guards by content fingerprint alone.
  [[nodiscard]] virtual bool revisionGuard() const { return true; }

  // Runs the two fixed read-only scripts and times them. Never takes script text from a caller.
  virtual ScriptRevision scriptRevision() = 0;

  // Runs one script that core/write_ops.cpp built from a fixed template. Main thread only.
  virtual ScriptRun executeFixedScript(const std::string& script) = 0;
  // The popup parameters of every effect on `layer`, in effect order. Read-only. Hosts that cannot read them throw.
  virtual std::vector<EffectPopups> layerEffectPopups([[maybe_unused]] LayerRef layer) {
    throw HostFailure("this host cannot read popup menus", 0, "UNSUPPORTED");
  }
  // The Options-dialog flag of every effect the plug-in files list, once the background scan finished; nothing before
  // that (the census then leaves the field out and the sidecar treats it as unknown).
  virtual std::optional<std::vector<EffectDialogFlag>> effectDialogFlags() { return std::nullopt; }
  // True only while that scan is still running; a host with no scan is never pending.
  virtual bool effectDialogScanPending() { return false; }
  // The installed CEP extension's host jsx (folder name containing "extynt" under the CEP extensions folders).
  virtual LibraryEntry libraryEntry() = 0;
  // Drops what a request cached (item handles, selection) after a script may have changed the project, so the
  // next native read starts from the host's current state. Counters and warnings are kept.
  virtual void invalidateCaches() {}

 protected:
  // Copyable only by subclasses (an in-memory scene is built by value); never sliced through the interface.
  HostReader() = default;
  HostReader(const HostReader&) = default;
  HostReader(HostReader&&) = default;
};

// Releases a stream when it goes out of scope, so no path (exception included) leaks a stream ref. A failed release
// cannot be reported from a destructor, so the handle never touches the host again after one.
class StreamHandle {
 public:
  StreamHandle() = default;
  StreamHandle(HostReader& reader, StreamRef ref) : reader_(&reader), ref_(ref), open_(true) {}
  StreamHandle(const StreamHandle&) = delete;
  StreamHandle& operator=(const StreamHandle&) = delete;
  StreamHandle(StreamHandle&& other) noexcept : reader_(other.reader_), ref_(other.ref_), open_(other.open_) {
    other.open_ = false;
  }
  StreamHandle& operator=(StreamHandle&& other) noexcept {
    if (this != &other) {
      release();
      reader_ = other.reader_;
      ref_ = other.ref_;
      open_ = other.open_;
      other.open_ = false;
    }
    return *this;
  }
  ~StreamHandle() { release(); }
  [[nodiscard]] StreamRef get() const { return ref_; }

 private:
  void release() {
    if (open_ && reader_) {
      open_ = false;
      try {
        reader_->closeStream(ref_);
      } catch (...) {
        reader_ = nullptr;
      }
    }
  }
  HostReader* reader_ = nullptr;
  StreamRef ref_;
  bool open_ = false;
};

}
