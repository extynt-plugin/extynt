// Effect parameter numbering (the DOM starts at 1, AEGP also lists the input layer at 0), the
// debugFlags option, and what camera / light rows look like in the output.
#include <algorithm>
#include <string>
#include <vector>
#include <cstddef>
#include "fake_host.h"
#include "host_reader.h"
#include "json_probe.h"
#include "layer_rules.h"
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

const JsonValue& firstLayer(const JsonValue& result) {
  return at(result, "compositions").items.at(0).find("layers")->items.at(0);
}

std::vector<std::string> pathsOf(const JsonValue& layer) {
  std::vector<std::string> out;
  for (const JsonValue& entry : at(layer, "propertyPaths").items) out.push_back(at(entry, "path").text);
  return out;
}

bool contains(const std::vector<std::string>& paths, const std::string& path) {
  return std::find(paths.begin(), paths.end(), path) != paths.end();
}

JsonValue readProject(fake::Host& host, bool debugFlags = false) {
  WalkOptions options;
  options.detail = Detail::Full;
  options.debugFlags = debugFlags;
  Walker walker(host, options);
  return parsed(walker.readProject());
}

const char* const kBlur = "ADBE Effect Parade/ADBE Gaussian Blur 2";

TEST(effect_input_param_is_skipped_through_the_host_seam) {
  fake::Host host = fake::makeScene();
  const std::vector<std::string> paths = pathsOf(firstLayer(readProject(host)));
  CHECK(!contains(paths, std::string(kBlur) + "/ADBE Gaussian Blur 2-0000"));
  CHECK(!contains(paths, std::string(kBlur) + "#2/ADBE Gaussian Blur 2-0000"));
  CHECK(contains(paths, std::string(kBlur) + "/ADBE Gaussian Blur 2-0001"));
  CHECK(contains(paths, std::string(kBlur) + "/ADBE Gaussian Blur 2-0003"));
  size_t effectAt = 0;
  for (size_t i = 0; i < paths.size(); ++i) {
    if (paths[i] == kBlur) effectAt = i;
  }
  CHECK_EQ(paths.at(effectAt + 1), std::string(kBlur) + "/ADBE Gaussian Blur 2-0001");
  CHECK_EQ(paths.at(effectAt + 2), std::string(kBlur) + "/ADBE Gaussian Blur 2-0003");
  CHECK(host.open.empty());
}

TEST(effect_input_param_shows_when_the_host_does_not_skip_it) {
  fake::Host host = fake::makeScene();
  host.domSkipsEffectInput = false;
  const std::vector<std::string> paths = pathsOf(firstLayer(readProject(host)));
  CHECK(contains(paths, std::string(kBlur) + "/ADBE Gaussian Blur 2-0000"));
}

TEST(effect_skip_does_not_touch_other_groups_or_the_property_count) {
  fake::Host host = fake::makeScene();
  WalkOptions options;
  options.detail = Detail::Full;
  options.maxPropertiesPerLayer = 1000;
  Walker walker(host, options);
  const JsonValue skipped = parsed(walker.readProject());
  host.domSkipsEffectInput = false;
  Walker plain(host, options);
  const JsonValue shown = parsed(plain.readProject());
  CHECK_EQ(pathsOf(firstLayer(shown)).size(), pathsOf(firstLayer(skipped)).size() + 2);
  const std::vector<std::string> paths = pathsOf(firstLayer(skipped));
  CHECK(contains(paths, "ADBE Layer Styles/dropShadow%2Fmode2"));
  CHECK(contains(paths, "ADBE Root Vectors Group/ADBE Vector Group/ADBE Vector Shape"));
}

TEST(read_paths_never_resolves_the_effect_input_param) {
  fake::Host host = fake::makeScene();
  Walker walker(host, WalkOptions());
  const std::vector<PathTarget> targets = {
      {"2", "10", std::string(kBlur) + "/ADBE Gaussian Blur 2-0000"},
      {"2", "10", std::string(kBlur) + "/ADBE Gaussian Blur 2-0001"},
      {"2", "10", std::string(kBlur) + "#2/ADBE Gaussian Blur 2-0001"},
  };
  const JsonValue result = parsed(walker.readPaths(targets));
  const std::vector<JsonValue>& results = at(result, "results").items;
  CHECK_EQ(at(results.at(0), "error").text, std::string("PATH_NOT_FOUND"));
  CHECK(at(results.at(1), "found").boolean);
  CHECK(at(results.at(2), "found").boolean);
  CHECK(host.open.empty());
}

TEST(debug_flags_add_the_raw_flag_word_only_when_asked) {
  fake::Host host = fake::makeScene();
  host.comps[0].layers[0].root.kids[3].flags = 0x11;
  const JsonValue plain = readProject(host);
  for (const JsonValue& entry : at(firstLayer(plain), "propertyPaths").items) CHECK(entry.find("dynFlags") == nullptr);
  const JsonValue flagged = readProject(host, true);
  int seen = 0;
  for (const JsonValue& entry : at(firstLayer(flagged), "propertyPaths").items) {
    const JsonValue& flags = at(entry, "dynFlags");
    CHECK(flags.isNumber());
    if (at(entry, "path").text == "ADBE Effect Parade") {
      CHECK_EQ(flags.number, 17.0);
      ++seen;
    }
  }
  CHECK_EQ(seen, 1);
  CHECK(parseRequest("{\"op\":\"read_comp\",\"compId\":\"2\",\"debugFlags\":true}").request.debugFlags);
  CHECK(!parseRequest("{\"op\":\"read_comp\",\"compId\":\"2\"}").request.debugFlags);
  CHECK_EQ(parseRequest("{\"op\":\"read_comp\",\"compId\":\"2\",\"debugFlags\":1}").errorCode,
           std::string("BAD_REQUEST"));
}

TEST(a_camera_row_reads_like_the_dom_through_the_writer) {
  fake::Host host = fake::makeScene();
  LayerRow& row = host.comps[0].layers[1].row;
  row.type = LayerType::Camera;
  row.threeD = true;
  row.switches.quality = std::string("WIREFRAME");
  row.switches.frameBlending = std::string("NO_FRAME_BLEND");
  applyDomLayerRules(row);
  WalkOptions options;
  options.detail = Detail::Structure;
  Walker walker(host, options);
  const JsonValue result = parsed(walker.readComp("2"));
  const JsonValue& camera = at(result, "compositions").items.at(0).find("layers")->items.at(1);
  CHECK(at(camera, "threeD").boolean == false);
  const JsonValue& switches = at(camera, "switches");
  CHECK(at(switches, "quality").isNull());
  CHECK(at(switches, "frame-blending").isNull());
  CHECK(at(switches, "sampling").isNull());
  CHECK(at(switches, "motion-blur").boolean == false);
}

}
