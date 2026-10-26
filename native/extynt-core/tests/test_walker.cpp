// Tests for the project walker's items, rows, paths and digests.
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "executor.h"
#include "fake_host.h"
#include "host_reader.h"
#include "json_probe.h"
#include "request.h"
#include "testing.h"
#include "walker.h"

using namespace extynt;

namespace {

JsonValue parsed(const std::string& text) {
  JsonValue value;
  std::string error;
  if (!parseJson(text, value, error)) throw testing::Failure{"bad JSON from walker: " + error + "\n" + text};
  return value;
}

const JsonValue& at(const JsonValue& value, const char* key) {
  const JsonValue* found = value.find(key);
  if (!found) throw testing::Failure{std::string("missing key ") + key};
  return *found;
}

const JsonValue& item(const JsonValue& array, size_t index) {
  if (!array.isArray() || index >= array.items.size()) throw testing::Failure{"array index out of range"};
  return array.items[index];
}

const JsonValue* entryByPath(const JsonValue& layer, const std::string& path) {
  for (const JsonValue& entry : at(layer, "propertyPaths").items) {
    if (at(entry, "path").text == path) return &entry;
  }
  return nullptr;
}

std::vector<std::string> pathsOf(const JsonValue& layer) {
  std::vector<std::string> out;
  for (const JsonValue& entry : at(layer, "propertyPaths").items) out.push_back(at(entry, "path").text);
  return out;
}

WalkOptions fullOptions() {
  WalkOptions options;
  options.detail = Detail::Full;
  return options;
}

JsonValue readFull(fake::Host& host, WalkOptions options = fullOptions()) {
  Walker walker(host, options);
  return parsed(walker.readProject());
}

TEST(walker_items_and_comps) {
  fake::Host host = fake::makeScene();
  const JsonValue result = readFull(host);
  CHECK_EQ(at(result, "source").text, std::string("native"));
  CHECK_EQ(at(at(result, "project"), "name").text, std::string("Test Project.aep"));
  CHECK_EQ(at(result, "activeCompositionId").text, std::string("2"));
  CHECK_EQ(at(result, "currentTime").number, 1.5);
  CHECK_EQ(item(at(result, "selectedLayerIds"), 0).text, std::string("10"));
  CHECK_EQ(at(result, "itemCount").number, 4.0);
  const JsonValue& items = at(result, "items");
  CHECK_EQ(items.items.size(), size_t(4));
  CHECK_EQ(at(item(items, 1), "type").text, std::string("composition"));
  CHECK_EQ(at(item(items, 1), "compositionId").text, std::string("2"));
  CHECK_EQ(at(item(items, 0), "type").text, std::string("folder"));
  CHECK_EQ(at(item(items, 2), "parentFolderId").text, std::string("1"));
  const JsonValue& sources = at(result, "sources");
  CHECK_EQ(sources.items.size(), size_t(1));
  CHECK_EQ(at(item(sources, 0), "type").text, std::string("solid"));
  const JsonValue& comps = at(result, "compositions");
  CHECK_EQ(comps.items.size(), size_t(2));
  CHECK_EQ(at(item(comps, 0), "name").text, std::string("Main"));
  CHECK_EQ(at(item(comps, 0), "frameRate").number, 29.97);
  const JsonValue& layers = at(item(comps, 0), "layers");
  CHECK_EQ(layers.items.size(), size_t(2));
  CHECK_EQ(at(item(layers, 0), "id").text, std::string("10"));
  CHECK_EQ(at(item(layers, 1), "parentId").text, std::string("10"));
  CHECK(at(item(layers, 0), "parentId").type == JsonValue::Type::Null);
  CHECK(host.open.empty());
}

TEST(walker_structure_detail_has_no_properties) {
  fake::Host host = fake::makeScene();
  WalkOptions options;
  options.detail = Detail::Structure;
  const JsonValue result = readFull(host, options);
  const JsonValue& layer = item(at(item(at(result, "compositions"), 0), "layers"), 0);
  CHECK(layer.find("propertyPaths") == nullptr);
  CHECK(layer.find("switches") != nullptr);
}

TEST(walker_transform_first_and_path_encoding) {
  fake::Host host = fake::makeScene();
  const JsonValue result = readFull(host);
  const JsonValue& layer = item(at(item(at(result, "compositions"), 0), "layers"), 0);
  std::vector<std::string> paths = pathsOf(layer);
  CHECK_EQ(paths.at(0), std::string("ADBE Transform Group"));
  CHECK_EQ(paths.at(1), std::string("ADBE Transform Group/ADBE Anchor Point"));
  CHECK_EQ(paths.at(2), std::string("ADBE Transform Group/ADBE Position"));
  CHECK_EQ(paths.at(6), std::string("ADBE Marker"));
  CHECK_EQ(paths.at(7), std::string("ADBE Root Vectors Group"));
  CHECK(entryByPath(layer, "ADBE Root Vectors Group/ADBE Vector Group") != nullptr);
  CHECK(entryByPath(layer, "ADBE Root Vectors Group/ADBE Vector Group/ADBE Vector Shape") != nullptr);
  CHECK(entryByPath(layer, "ADBE Root Vectors Group/ADBE Vector Group#2") != nullptr);
  CHECK(entryByPath(layer, "ADBE Root Vectors Group/ADBE Vector Group#2/ADBE Vector Fill Color") != nullptr);
  CHECK(entryByPath(layer, "ADBE Effect Parade/ADBE Gaussian Blur 2#2/ADBE Gaussian Blur 2-0001") != nullptr);
  CHECK(entryByPath(layer, "ADBE Layer Styles/dropShadow%2Fmode2") != nullptr);
  CHECK(entryByPath(layer, "unknown") != nullptr);
  CHECK(layer.find("propertyPathsTruncated")->boolean == false);
  CHECK(host.open.empty());
}

TEST(walker_entry_fields) {
  fake::Host host = fake::makeScene();
  const JsonValue result = readFull(host);
  const JsonValue& layer = item(at(item(at(result, "compositions"), 0), "layers"), 0);

  const JsonValue& transform = *entryByPath(layer, "ADBE Transform Group");
  CHECK_EQ(at(transform, "kind").text, std::string("group"));
  CHECK_EQ(at(transform, "valueType").text, std::string("unknown"));
  CHECK(at(transform, "value").type == JsonValue::Type::Null);
  CHECK(at(transform, "canSetValue").boolean == false);
  CHECK(transform.find("expression") == nullptr);

  const JsonValue& position = *entryByPath(layer, "ADBE Transform Group/ADBE Position");
  CHECK_EQ(at(position, "kind").text, std::string("property"));
  CHECK_EQ(at(position, "valueType").text, std::string("vector"));
  CHECK_EQ(at(position, "matchName").text, std::string("ADBE Position"));
  CHECK_EQ(at(position, "displayName").text, std::string("Position"));
  const JsonValue& pv = at(position, "value");
  CHECK(pv.isArray() && pv.items.size() == 2);
  CHECK_EQ(pv.items[0].number, 960.0);
  CHECK_EQ(pv.items[1].number, 540.5);
  CHECK(at(position, "canSetValue").boolean);
  CHECK_EQ(at(position, "expressionEnabled").boolean, false);
  CHECK(at(position, "expression").type == JsonValue::Type::Null);
  CHECK(position.find("keyframeCount") == nullptr);
  CHECK(position.find("animatable") == nullptr);
  CHECK(position.find("hidden") == nullptr);

  const JsonValue& scale = *entryByPath(layer, "ADBE Transform Group/ADBE Scale");
  CHECK_EQ(at(scale, "value").items.size(), size_t(3));

  const JsonValue& opacity = *entryByPath(layer, "ADBE Transform Group/ADBE Opacity");
  CHECK_EQ(at(opacity, "keyframeCount").number, 3.0);
  CHECK_EQ(at(opacity, "animatable").boolean, false);
  CHECK(at(opacity, "expressionEnabled").boolean);
  CHECK_EQ(at(opacity, "expression").text, std::string("wiggle(2,10)"));
}

TEST(walker_entry_fields_for_fills_shapes_effects_and_hidden_properties) {
  fake::Host host = fake::makeScene();
  const JsonValue result = readFull(host);
  const JsonValue& layer = item(at(item(at(result, "compositions"), 0), "layers"), 0);

  const JsonValue& fill = *entryByPath(layer, "ADBE Root Vectors Group/ADBE Vector Group/ADBE Vector Fill Color");
  CHECK_EQ(at(fill, "valueType").text, std::string("color"));
  CHECK_EQ(at(fill, "value").items.size(), size_t(4));
  CHECK_EQ(at(fill, "value").items[1].number, 0.5);

  const JsonValue& shape = *entryByPath(layer, "ADBE Root Vectors Group/ADBE Vector Group/ADBE Vector Shape");
  CHECK_EQ(at(at(shape, "value"), "unsupported").text, std::string("shape-path"));
  CHECK_EQ(at(shape, "valueType").text, std::string("unknown"));

  const JsonValue& effect = *entryByPath(layer, "ADBE Effect Parade/ADBE Gaussian Blur 2");
  CHECK_EQ(at(effect, "kind").text, std::string("effect"));
  CHECK(at(effect, "enabled").boolean);
  CHECK(at(effect, "canSetValue").boolean == false);
  CHECK(entryByPath(layer, "ADBE Effect Parade/ADBE Gaussian Blur 2#2")->find("enabled")->boolean == false);
  CHECK(entryByPath(layer, "ADBE Effect Parade")->find("enabled") == nullptr);

  const JsonValue& hiddenParam =
      *entryByPath(layer, "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0003");
  CHECK(at(hiddenParam, "hidden").boolean);
  CHECK(at(hiddenParam, "canSetValue").boolean);
  const JsonValue& hiddenX = *entryByPath(layer, "ADBE Separate Position X");
  CHECK(at(hiddenX, "hidden").boolean);
  CHECK(at(hiddenX, "canSetValue").boolean == false);

  CHECK(at(*entryByPath(layer, "ADBE Layer Styles/dropShadow%2Fmode2"), "enabled").boolean);
  CHECK(at(*entryByPath(layer, "unknown"), "canSetValue").boolean == false);
  CHECK_EQ(at(*entryByPath(layer, "ADBE Marker"), "valueType").text, std::string("unknown"));
}

TEST(walker_max_properties_is_optional_and_reports_truncation) {
  fake::Host host = fake::makeScene();
  WalkOptions options = fullOptions();
  options.maxPropertiesPerLayer = 3;
  const JsonValue result = readFull(host, options);
  const JsonValue& layer = item(at(item(at(result, "compositions"), 0), "layers"), 0);
  CHECK_EQ(at(layer, "propertyPaths").items.size(), size_t(3));
  CHECK(at(layer, "propertyPathsTruncated").boolean);
  bool warned = false;
  for (const JsonValue& w : at(result, "warnings").items) warned |= w.text.rfind("property-count-limit:", 0) == 0;
  CHECK(warned);
  CHECK(host.open.empty());

  fake::Host unlimited = fake::makeScene();
  const JsonValue all = readFull(unlimited);
  CHECK(at(item(at(item(at(all, "compositions"), 0), "layers"), 0), "propertyPaths").items.size() > 20);
}

TEST(walker_depth_limit_is_a_warning) {
  fake::Host host = fake::makeScene();
  WalkOptions options = fullOptions();
  options.maxPropertyDepth = 1;
  const JsonValue result = readFull(host, options);
  const JsonValue& layer = item(at(item(at(result, "compositions"), 0), "layers"), 0);
  CHECK(entryByPath(layer, "ADBE Root Vectors Group/ADBE Vector Group") != nullptr);
  CHECK(entryByPath(layer, "ADBE Root Vectors Group/ADBE Vector Group/ADBE Vector Shape") == nullptr);
  bool warned = false;
  for (const JsonValue& w : at(result, "warnings").items) warned |= w.text.rfind("property-depth-limit:", 0) == 0;
  CHECK(warned);
}

TEST(walker_read_comp) {
  fake::Host host = fake::makeScene();
  Walker walker(host, fullOptions());
  const JsonValue result = parsed(walker.readComp("3"));
  const JsonValue& comps = at(result, "compositions");
  CHECK_EQ(comps.items.size(), size_t(1));
  CHECK_EQ(at(item(comps, 0), "id").text, std::string("3"));
  CHECK(result.find("items") == nullptr);
  Walker missing(host, fullOptions());
  bool threw = false;
  try {
    missing.readComp("999");
  } catch (const HostFailure& failure) {
    threw = failure.code() == "COMP_NOT_FOUND";
  }
  CHECK(threw);
}

struct Hashes {
  std::string project, items, mainComp, subComp, layerA, layerB, layerSolo;
};

Hashes hashesOf(fake::Host& host) {
  Walker walker(host, fullOptions());
  const JsonValue result = parsed(walker.hashProject());
  const JsonValue& comps = at(result, "compositions");
  Hashes h;
  h.project = at(result, "projectHash").text;
  h.items = at(result, "itemsHash").text;
  h.mainComp = at(item(comps, 0), "hash").text;
  h.subComp = at(item(comps, 1), "hash").text;
  h.layerA = at(item(at(item(comps, 0), "layers"), 0), "hash").text;
  h.layerB = at(item(at(item(comps, 0), "layers"), 1), "hash").text;
  h.layerSolo = at(item(at(item(comps, 1), "layers"), 0), "hash").text;
  return h;
}

TEST(hash_project_is_stable_and_localized) {
  fake::Host host = fake::makeScene();
  const Hashes before = hashesOf(host);
  CHECK_EQ(before.project.size(), size_t(32));
  const Hashes again = hashesOf(host);
  CHECK_EQ(again.project, before.project);
  CHECK_EQ(again.layerA, before.layerA);

  host.comps[0].layers[0].root.kids[2].kids[1].leaf.value = fake::vec2(961, 540.5);
  const Hashes after = hashesOf(host);
  CHECK(after.layerA != before.layerA);
  CHECK(after.mainComp != before.mainComp);
  CHECK(after.project != before.project);
  CHECK_EQ(after.layerB, before.layerB);
  CHECK_EQ(after.subComp, before.subComp);
  CHECK_EQ(after.layerSolo, before.layerSolo);
  CHECK_EQ(after.items, before.items);

  host.comps[1].layers[0].row.name = "Renamed";
  const Hashes renamed = hashesOf(host);
  CHECK(renamed.layerSolo != after.layerSolo);
  CHECK(renamed.subComp != after.subComp);
  CHECK_EQ(renamed.mainComp, after.mainComp);

  host.itemRows[3].name = "Other Solid";
  const Hashes items = hashesOf(host);
  CHECK(items.items != renamed.items);
  CHECK(items.project != renamed.project);
  CHECK_EQ(items.mainComp, renamed.mainComp);
}

TEST(hash_property_hashes_listed_on_request) {
  fake::Host host = fake::makeScene();
  WalkOptions options = fullOptions();
  options.propertyHashes = true;
  Walker walker(host, options);
  const JsonValue result = parsed(walker.hashProject());
  const JsonValue& layer = item(at(item(at(result, "compositions"), 0), "layers"), 0);
  const JsonValue& list = at(layer, "propertyHashes");
  CHECK_EQ(static_cast<int64_t>(list.items.size()), static_cast<int64_t>(at(layer, "properties").number));
  CHECK_EQ(at(item(list, 0), "path").text, std::string("ADBE Transform Group"));
  CHECK_EQ(at(item(list, 0), "hash").text.size(), size_t(32));
}

TEST(read_with_hashes_matches_hash_project) {
  fake::Host host = fake::makeScene();
  WalkOptions options = fullOptions();
  options.hashes = true;
  const JsonValue read = readFull(host, options);
  const Hashes h = hashesOf(host);
  CHECK_EQ(at(read, "projectHash").text, h.project);
  CHECK_EQ(at(item(at(read, "compositions"), 0), "hash").text, h.mainComp);
  CHECK_EQ(at(item(at(item(at(read, "compositions"), 0), "layers"), 0), "hash").text, h.layerA);
}

TEST(read_paths_resolves_encoded_and_repeated_segments) {
  fake::Host host = fake::makeScene();
  Walker walker(host, fullOptions());
  const std::vector<PathTarget> targets = {
      {"2", "10", "ADBE Transform Group/ADBE Position"},
      {"2", "10", "ADBE Effect Parade/ADBE Gaussian Blur 2#2/ADBE Gaussian Blur 2-0001"},
      {"2", "10", "ADBE Layer Styles/dropShadow%2Fmode2"},
      {"2", "10", "ADBE Root Vectors Group/ADBE Vector Group#2"},
      {"2", "10", "ADBE Transform Group/ADBE Nope"},
      {"2", "99", "ADBE Transform Group"},
      {"77", "10", "ADBE Transform Group"},
      {"2", "10", "ADBE Transform Group//x"},
      {"3", "20", "ADBE Transform Group/ADBE Opacity"},
  };
  const JsonValue result = parsed(walker.readPaths(targets));
  const JsonValue& results = at(result, "results");
  CHECK_EQ(results.items.size(), targets.size());
  CHECK(at(item(results, 0), "found").boolean);
  CHECK_EQ(at(at(item(results, 0), "entry"), "value").items[0].number, 960.0);
  CHECK_EQ(at(at(item(results, 0), "layer"), "name").text, std::string("Shape A"));
  CHECK(at(item(results, 1), "found").boolean);
  CHECK_EQ(at(at(item(results, 1), "entry"), "value").number, 5.0);
  CHECK(at(at(item(results, 2), "entry"), "enabled").boolean);
  CHECK_EQ(at(at(item(results, 3), "entry"), "kind").text, std::string("group"));
  CHECK_EQ(at(item(results, 4), "error").text, std::string("PATH_NOT_FOUND"));
  CHECK(item(results, 4).find("layer") != nullptr);
  CHECK_EQ(at(item(results, 5), "error").text, std::string("LAYER_NOT_FOUND"));
  CHECK_EQ(at(item(results, 6), "error").text, std::string("COMP_NOT_FOUND"));
  CHECK_EQ(at(item(results, 7), "error").text, std::string("BAD_PATH"));
  CHECK(at(item(results, 8), "found").boolean);
  CHECK(host.open.empty());
}

TEST(read_paths_entry_equals_full_walk_entry) {
  fake::Host host = fake::makeScene();
  const JsonValue full = readFull(host);
  const JsonValue& layer = item(at(item(at(full, "compositions"), 0), "layers"), 0);
  Walker walker(host, fullOptions());
  for (const std::string& path :
       {std::string("ADBE Transform Group/ADBE Opacity"), std::string("ADBE Effect Parade/ADBE Gaussian Blur 2#2"),
        std::string("ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0003"), std::string("ADBE Marker")}) {
    const JsonValue targeted = parsed(walker.readPaths({{"2", "10", path}}));
    const JsonValue& entry = at(item(at(targeted, "results"), 0), "entry");
    const JsonValue* expected = entryByPath(layer, path);
    CHECK(expected != nullptr);
    CHECK_EQ(at(entry, "kind").text, at(*expected, "kind").text);
    CHECK_EQ(at(entry, "canSetValue").boolean, at(*expected, "canSetValue").boolean);
    CHECK_EQ(entry.members.size(), expected->members.size());
  }
}

TEST(executor_envelope_and_timing) {
  fake::Host host = fake::makeScene();
  fake::Exec exec;
  ServerInfo& info = exec.info;
  info.pluginVersion = "0.1.0";
  info.aeVersion = "26.5";
  info.suitesJson = "{\"layer\":15}";
  const Request request = parseRequest(R"({"id":"r1","op":"read_comp","compId":"2"})").request;
  const JsonValue response = parsed(executeRequest(request, host, exec.context(), 1.25));
  CHECK(at(response, "ok").boolean);
  CHECK_EQ(at(response, "id").text, std::string("r1"));
  CHECK_EQ(at(response, "op").text, std::string("read_comp"));
  const JsonValue& timing = at(response, "timing");
  CHECK_EQ(at(timing, "queuedMs").number, 1.25);
  CHECK(at(timing, "getterCalls").number > 10);
  CHECK(at(timing, "bytes").number > 500);
  for (const char* key : {"walkMs", "hashMs", "serializeMs", "totalMainThreadMs"}) CHECK(at(timing, key).number >= 0);
  CHECK(at(timing, "totalMainThreadMs").number >= at(timing, "serializeMs").number);
  CHECK(at(response, "result").find("compositions") != nullptr);

  const JsonValue ping =
      parsed(executeRequest(parseRequest(R"({"id":1,"op":"ping"})").request, host, exec.context(), 0));
  CHECK(at(at(ping, "result"), "pong").boolean);
  CHECK(at(at(ping, "result"), "mainThread").boolean);
  CHECK_EQ(at(at(at(ping, "result"), "suites"), "layer").number, 15.0);
  CHECK_EQ(at(at(ping, "timing"), "getterCalls").number, 0.0);
}

TEST(executor_maps_host_failures_to_error_responses) {
  fake::Host host = fake::makeScene();
  fake::Exec exec;
  host.noProject = true;
  const JsonValue noProject =
      parsed(executeRequest(parseRequest(R"({"op":"read_project"})").request, host, exec.context(), 0));
  CHECK(at(noProject, "ok").boolean == false);
  CHECK_EQ(at(at(noProject, "error"), "code").text, std::string("NO_PROJECT"));

  host.noProject = false;
  host.failOnLeafMatch = "ADBE Position";
  const JsonValue failed =
      parsed(executeRequest(parseRequest(R"({"op":"read_project","detail":"full"})").request, host, exec.context(), 0));
  CHECK(at(failed, "ok").boolean == false);
  CHECK_EQ(at(at(failed, "error"), "code").text, std::string("HOST_ERROR"));
  CHECK_EQ(at(at(failed, "error"), "aeErr").number, 42.0);
  CHECK(host.open.empty());

  const JsonValue missing =
      parsed(executeRequest(parseRequest(R"({"op":"read_comp","compId":"404"})").request, host, exec.context(), 0));
  CHECK_EQ(at(at(missing, "error"), "code").text, std::string("COMP_NOT_FOUND"));
}

}
