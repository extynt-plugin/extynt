// The in-memory fake host the core tests run against: a scripted scene and a recording of every call.
#include "fake_host.h"
#include "digest_sink.h"
#include "hash128.h"
#include "host_reader.h"
#include "watch.h"
#include <string>
#include <vector>
#include <cstdint>
#include <cstddef>
#include <utility>

namespace fake {

Layer* Host::findLayer(const Id& compId, const Id& layerId) {
  for (Comp& comp : comps) {
    if (comp.row.id != compId) continue;
    for (Layer& layer : comp.layers) {
      if (layer.row.id == layerId) return &layer;
    }
  }
  return nullptr;
}

bool Host::setOpacity(const Id& compId, const Id& layerId, double value) {
  Layer* layer = findLayer(compId, layerId);
  if (layer == nullptr) return false;
  for (Node& group : layer->root.kids) {
    for (Node& leafNode : group.kids) {
      if (leafNode.match != "ADBE Opacity") continue;
      leafNode.leaf.value = number(value);
      return true;
    }
  }
  return false;
}

StreamRef Host::track(Node* node) {
  nodeRefs.push_back(StreamToken{node});
  const StreamRef ref{&nodeRefs.back()};
  open.insert(ref);
  return ref;
}

LayerRef Host::trackLayer(Layer* layer) {
  layerRefs.push_back(LayerToken{layer});
  return LayerRef{&layerRefs.back()};
}

void Host::beginRequest() {
  calls = 0;
  ++beginRequests;
  warnings.clear();
}

ProjectInfo Host::project() {
  ++calls;
  if (noProject) throw HostFailure("no project open", 0, "NO_PROJECT");
  return projectInfo;
}

std::vector<ItemRow> Host::items() {
  ++calls;
  return itemRows;
}

bool Host::openComp(const Id& id, CompRow& out) {
  ++calls;
  for (Comp& comp : comps) {
    if (comp.row.id == id) {
      current = &comp;
      out = comp.row;
      return true;
    }
  }
  return false;
}

std::vector<Id> Host::selectedLayerIds() {
  ++calls;
  return current->selected;
}

LayerRef Host::layerAt(int64_t index1, LayerRow& out) {
  ++calls;
  Layer& layer = current->layers.at(static_cast<size_t>(index1 - 1));
  out = layer.row;
  return trackLayer(&layer);
}

bool Host::layerById(const Id& id, LayerRef& ref, LayerRow& out) {
  ++calls;
  for (Layer& layer : current->layers) {
    if (layer.row.id == id) {
      ref = trackLayer(&layer);
      out = layer.row;
      return true;
    }
  }
  return false;
}

StreamRef Host::openLayerRoot(LayerRef layer) {
  ++calls;
  return track(&layer.value->layer->root);
}

int64_t Host::childCount(StreamRef group) {
  ++calls;
  return static_cast<int64_t>(node(group).kids.size());
}

StreamRef Host::childAt(StreamRef group, int64_t index) {
  ++calls;
  return track(&node(group).kids.at(static_cast<size_t>(index)));
}

NodeInfo Host::describe(StreamRef ref) {
  ++calls;
  const Node& n = node(ref);
  NodeInfo info;
  info.matchName = n.match;
  info.displayName = n.name;
  info.grouping = n.grouping;
  info.hidden = n.hidden;
  info.enabled = n.enabled;
  info.rawFlags = n.flags;
  return info;
}

LeafInfo Host::readLeaf(StreamRef ref, [[maybe_unused]] const ReadOptions& options) {
  ++calls;
  const Node& n = node(ref);
  if (!failOnLeafMatch.empty() && n.match == failOnLeafMatch) throw HostFailure("boom reading " + n.match, 42);
  return n.leaf;
}

bool Host::streamContentDigest(StreamRef ref, [[maybe_unused]] const LeafInfo& leafInfo, Hasher& into) {
  ++contentCalls;
  const Content& content = node(ref).content;
  DigestSink sink(into);
  sink.put(static_cast<uint64_t>(content.keys.size()));
  for (const FakeKey& key : content.keys) {
    sink.put(key.time);
    sink.put(key.value);
    sink.put(key.interpolation);
    sink.put(key.ease);
  }
  sink.put(static_cast<uint64_t>(content.text.size()));
  sink.putText(content.text);
  sink.put(static_cast<uint64_t>(content.markers.size()));
  for (const FakeMarker& marker : content.markers) {
    sink.put(marker.time);
    sink.put(static_cast<uint64_t>(marker.comment.size()));
    sink.putText(marker.comment);
    sink.put(marker.duration);
    sink.put(marker.protectedRegion);
  }
  sink.put(content.closed);
  sink.put(static_cast<uint64_t>(content.path.size()));
  for (const FakeVertex& vertex : content.path) sink.put(vertex);
  sink.put(content.layerRef);
  return true;
}

int64_t Host::firstChildIndex([[maybe_unused]] StreamRef group, bool groupIsEffect) {
  return groupIsEffect && domSkipsEffectInput ? 1 : 0;
}

ScriptRevision Host::scriptRevision() {
  ++calls;
  return scriptCost;
}

std::string Host::guardAnswer() {
  if (engineNotReadyCalls > 0) {
    --engineNotReadyCalls;
    return "not-ready";
  }
  if (!libraryLoadError.empty()) return "ERR:" + libraryLoadError;
  if (libraryResident) return "resident";
  libraryResident = true;
  ++libraryLoads;
  return "loaded";
}

ScriptRun Host::defaultScript(const std::string& script) {
  ScriptRun run;
  run.us = 250;
  run.result = "OK";
  if (script == kRevisionScript) {
    run.result = std::to_string(revision);
    if (revisionFails) run = ScriptRun{"", 250, "Error 21: undefined is not an object"};
  } else if (script.rfind("if (typeof JSON !== \"object\")", 0) == 0) {
    run.result = guardAnswer();
  } else if (script.rfind("__extyntProjectEpoch = ", 0) == 0) {
    const size_t nameStart = script.find("; ") + 2;
    const std::string name = script.substr(nameStart, script.find('(', nameStart) - nameStart);
    const auto answer = entryAnswers.find(name);
    run.result = answer == entryAnswers.end() ? R"({"ok":true})" : answer->second;
  }
  return run;
}

ScriptRun Host::executeFixedScript(const std::string& script) {
  ++calls;
  scripts.push_back(script);
  if (scriptHook) return scriptHook(script, *this);
  return defaultScript(script);
}

namespace {

Node shapeLayerRoot() {
  const Node rotation = leaf("ADBE Rotate Z", "Rotation", ValueType::OneD, number(0));
  const Node position = leaf("ADBE Position", "Position", ValueType::TwoDSpatial, vec2(960, 540.5));
  const Node scale = leaf("ADBE Scale", "Scale", ValueType::ThreeD, vec3(100, 100, 100));
  Node opacity = leaf("ADBE Opacity", "Opacity", ValueType::OneD, number(100));
  opacity.leaf.numKeys = 3;
  opacity.leaf.animatable = false;
  opacity.leaf.expressionEnabled = true;
  opacity.leaf.expression = "wiggle(2,10)";
  const Node anchor = leaf("ADBE Anchor Point", "Anchor Point", ValueType::ThreeDSpatial, vec3(0, 0, 0));
  const Node transform = group("ADBE Transform Group", "Transform", {anchor, position, scale, rotation, opacity});

  const Node shapePath = leaf("ADBE Vector Shape", "Path", ValueType::Mask, unsupported("shape-path"));
  const Node fill = leaf("ADBE Vector Fill Color", "Color", ValueType::Color, color(1, 0.5, 0.25, 1));
  const Node vecGroup = group("ADBE Vector Group", "Group 1", {shapePath, fill});
  const Node vecGroup2 = group("ADBE Vector Group", "Group 2", {shapePath, fill});
  const Node contents = group("ADBE Root Vectors Group", "Contents", {vecGroup, vecGroup2}, Grouping::Indexed);

  const Node input = leaf("ADBE Gaussian Blur 2-0000", "Layer", ValueType::LayerId, unsupported("layer-id"));
  const Node radius = leaf("ADBE Gaussian Blur 2-0001", "Blurriness", ValueType::OneD, number(5));
  Node hiddenParam = leaf("ADBE Gaussian Blur 2-0003", "Hidden", ValueType::OneD, number(1));
  hiddenParam.hidden = true;
  Node blur = group("ADBE Gaussian Blur 2", "Gaussian Blur", {input, radius, hiddenParam});
  blur.enabled = true;
  Node blur2 = blur;
  blur2.enabled = false;
  const Node effects = group("ADBE Effect Parade", "Effects", {blur, blur2}, Grouping::Indexed);

  Node mode = leaf("dropShadow/mode2", "Blend Mode", ValueType::OneD, number(3));
  mode.enabled = true;
  const Node styles = group("ADBE Layer Styles", "Layer Styles", {mode});

  const Node marker = leaf("ADBE Marker", "Marker", ValueType::Marker, unsupported("marker"));
  Node noName = leaf("", "", ValueType::NoData, ValueRead());
  noName.grouping = Grouping::Leaf;
  Node hiddenX = leaf("ADBE Separate Position X", "X Position", ValueType::OneD, number(0));
  hiddenX.hidden = true;

  return group("", "", {marker, contents, transform, effects, styles, hiddenX, noName}, Grouping::Named);
}

struct LayerSpec {
  std::string id;
  int64_t index;
  std::string name;
  LayerType type;
};

Layer makeLayer(const LayerSpec& spec, Node root) {
  Layer layer;
  layer.row.id = spec.id;
  layer.row.index = spec.index;
  layer.row.name = spec.name;
  layer.row.type = spec.type;
  layer.row.enabled = true;
  layer.row.inPoint = 0;
  layer.row.outPoint = 10;
  layer.row.startTime = 0;
  layer.row.stretchPercent = 100;
  layer.row.audioEnabled = false;
  layer.root = std::move(root);
  return layer;
}

std::vector<ItemRow> sceneItems() {
  ItemRow folder;
  folder.id = "1";
  folder.name = "Folder";
  folder.kind = ItemKind::Folder;
  ItemRow main;
  main.id = "2";
  main.name = "Main";
  main.kind = ItemKind::Comp;
  main.parentFolderId = std::string("0");
  ItemRow sub;
  sub.id = "3";
  sub.name = "Sub";
  sub.kind = ItemKind::Comp;
  sub.parentFolderId = std::string("1");
  ItemRow solid;
  solid.id = "4";
  solid.name = "Black Solid";
  solid.kind = ItemKind::Footage;
  solid.still = true;
  solid.width = 1920;
  solid.height = 1080;
  solid.duration = 5;
  return {folder, main, sub, solid};
}

Comp mainComposition() {
  Comp mainComp;
  mainComp.row.id = "2";
  mainComp.row.name = "Main";
  mainComp.row.width = 1920;
  mainComp.row.height = 1080;
  mainComp.row.duration = 10;
  mainComp.row.frameRate = 29.97;
  mainComp.row.currentTime = 1.5;
  mainComp.row.numLayers = 2;
  Layer a = makeLayer({"10", 1, "Shape A", LayerType::Shape}, shapeLayerRoot());
  a.row.selected = true;
  Layer b = makeLayer({"11", 2, "Null B", LayerType::Null},
                      group("", "",
                            {group("ADBE Transform Group", "Transform",
                                   {leaf("ADBE Position", "Position", ValueType::TwoDSpatial, vec2(1, 2))})}));
  b.row.parentId = std::string("10");
  mainComp.layers = {a, b};
  mainComp.selected = {"10"};
  return mainComp;
}

Comp subComposition() {
  Comp subComp;
  subComp.row.id = "3";
  subComp.row.name = "Sub";
  subComp.row.width = 640;
  subComp.row.height = 360;
  subComp.row.duration = 4;
  subComp.row.frameRate = 24;
  subComp.row.numLayers = 1;
  subComp.layers = {makeLayer({"20", 1, "Solo", LayerType::Av},
                              group("", "",
                                    {group("ADBE Transform Group", "Transform",
                                           {leaf("ADBE Opacity", "Opacity", ValueType::OneD, number(50))})}))};
  return subComp;
}

}

Host makeScene() {
  Host host;
  host.projectInfo.name = "Test Project.aep";
  host.projectInfo.filePath = "/tmp/Test Project.aep";
  host.projectInfo.activeCompId = std::string("2");
  host.itemRows = sceneItems();
  host.comps = {mainComposition(), subComposition()};
  return host;
}

}
