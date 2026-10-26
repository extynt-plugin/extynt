// The layer hash covers the content the jsx details read and the row JSON does not carry: key times, values and easing,
// text, markers and path vertices. Each test edits one such thing in the fake scene and compares layer hashes.
#include <cstddef>
#include <cstdint>
#include <initializer_list>
#include <string>

#include "fake_host.h"
#include "host_reader.h"
#include "json_probe.h"
#include "request.h"
#include "testing.h"
#include "walker.h"

using namespace extynt;

namespace {

constexpr size_t kLayerA = 0;
constexpr size_t kLayerB = 1;

const JsonValue& at(const JsonValue& value, const char* key) {
  const JsonValue* found = value.find(key);
  if (!found) throw testing::Failure{std::string("missing key ") + key};
  return *found;
}

std::string layerHash(fake::Host& host, size_t layer) {
  WalkOptions options;
  options.detail = Detail::Full;
  Walker walker(host, options);
  JsonValue result;
  std::string error;
  if (!parseJson(walker.hashProject(), result, error)) throw testing::Failure{"bad JSON: " + error};
  const JsonValue& layers = at(at(result, "compositions").items.at(0), "layers");
  return at(layers.items.at(layer), "hash").text;
}

fake::Node& nodeAt(fake::Host& host, std::initializer_list<size_t> route) {
  fake::Node* node = &host.comps[0].layers[kLayerA].root;
  for (const size_t index : route) node = &node->kids.at(index);
  return *node;
}

fake::Node& opacity(fake::Host& host) { return nodeAt(host, {2, 4}); }
fake::Node& marker(fake::Host& host) { return nodeAt(host, {0}); }
fake::Node& pathOne(fake::Host& host) { return nodeAt(host, {1, 0, 0}); }
fake::Node& pathTwo(fake::Host& host) { return nodeAt(host, {1, 1, 0}); }
fake::Node& text(fake::Host& host) { return host.comps[0].layers[kLayerA].root.kids.back(); }

fake::FakeKey key(double time, double value) {
  fake::FakeKey out;
  out.time = time;
  out.value = value;
  out.interpolation = 2;
  out.ease = {0, 0.33, 0, 0.33};
  return out;
}

fake::FakeVertex vertex(double x, double y) {
  fake::FakeVertex out;
  out.x = x;
  out.y = y;
  return out;
}

fake::Host contentScene() {
  fake::Host host = fake::makeScene();
  opacity(host).content.keys = {key(0, 100), key(1, 50), key(2, 0)};
  marker(host).leaf.numKeys = 2;
  marker(host).content.markers = {{1, "intro", 0, false}, {3, "outro", 0.5, false}};
  pathOne(host).content.path = {vertex(0, 0), vertex(100, 0), vertex(50, 80)};
  pathTwo(host).content.path = {vertex(0, 0), vertex(10, 0), vertex(5, 8)};
  fake::Node doc =
      fake::leaf("ADBE Text Document", "Source Text", ValueType::TextDocument, fake::unsupported("text-document"));
  doc.content.text = "Hello";
  host.comps[0].layers[kLayerA].root.kids.push_back(doc);
  return host;
}

void expectMoves(fake::Host& host, const std::string& before) { CHECK(layerHash(host, kLayerA) != before); }

TEST(content_hash_is_stable_when_nothing_changed) {
  fake::Host host = contentScene();
  const std::string first = layerHash(host, kLayerA);
  CHECK_EQ(layerHash(host, kLayerA), first);
  fake::Host other = contentScene();
  CHECK_EQ(layerHash(other, kLayerA), first);
}

TEST(content_hash_moves_with_a_key_time) {
  fake::Host host = contentScene();
  const std::string before = layerHash(host, kLayerA);
  const std::string untouched = layerHash(host, kLayerB);
  opacity(host).content.keys[1].time = 1.25;
  expectMoves(host, before);
  CHECK_EQ(layerHash(host, kLayerB), untouched);
}

TEST(content_hash_moves_with_a_key_value_away_from_the_current_time) {
  fake::Host host = contentScene();
  const std::string before = layerHash(host, kLayerA);
  opacity(host).content.keys[2].value = 10;
  expectMoves(host, before);
}

TEST(content_hash_moves_with_easing) {
  fake::Host host = contentScene();
  const std::string before = layerHash(host, kLayerA);
  opacity(host).content.keys[0].ease = {0, 0.8, 0, 0.33};
  expectMoves(host, before);
  const std::string eased = layerHash(host, kLayerA);
  opacity(host).content.keys[0].interpolation = 3;
  CHECK(layerHash(host, kLayerA) != eased);
}

TEST(content_hash_moves_with_text) {
  fake::Host host = contentScene();
  const std::string before = layerHash(host, kLayerA);
  text(host).content.text = "Hello!";
  expectMoves(host, before);
}

TEST(content_hash_moves_with_a_marker_time_and_comment) {
  fake::Host host = contentScene();
  const std::string before = layerHash(host, kLayerA);
  marker(host).content.markers[0].time = 1.5;
  const std::string moved = layerHash(host, kLayerA);
  CHECK(moved != before);
  marker(host).content.markers[0].comment = "intro v2";
  CHECK(layerHash(host, kLayerA) != moved);
  const std::string commented = layerHash(host, kLayerA);
  marker(host).content.markers[1].duration = 1;
  CHECK(layerHash(host, kLayerA) != commented);
}

TEST(content_hash_moves_with_a_mask_vertex_and_a_shape_path) {
  fake::Host host = contentScene();
  const std::string before = layerHash(host, kLayerA);
  pathOne(host).content.path[1].x = 101;
  const std::string reshaped = layerHash(host, kLayerA);
  CHECK(reshaped != before);
  pathOne(host).content.path[1].outX = 4;
  const std::string tangent = layerHash(host, kLayerA);
  CHECK(tangent != reshaped);
  pathTwo(host).content.path.push_back(vertex(1, 1));
  CHECK(layerHash(host, kLayerA) != tangent);
  const std::string grown = layerHash(host, kLayerA);
  pathTwo(host).content.closed = false;
  CHECK(layerHash(host, kLayerA) != grown);
}

TEST(content_hash_moves_with_a_layer_reference_target) {
  fake::Host host = contentScene();
  fake::Node reference =
      fake::leaf("ADBE Effect Parade Source", "Source", ValueType::LayerId, fake::unsupported("layer-id"));
  reference.content.layerRef = 3;
  host.comps[0].layers[kLayerA].root.kids.push_back(reference);
  const std::string before = layerHash(host, kLayerA);
  host.comps[0].layers[kLayerA].root.kids.back().content.layerRef = 2;
  CHECK(layerHash(host, kLayerA) != before);
}

TEST(content_digest_is_asked_only_for_keyed_or_detail_typed_leaves) {
  fake::Host host = contentScene();
  host.comps[0].layers[kLayerA].root.kids.pop_back();
  fake::Node& rotation = nodeAt(host, {2, 3});
  const std::string before = layerHash(host, kLayerA);
  CHECK_EQ(host.contentCalls, 4);
  rotation.content.keys = {key(0, 1)};
  rotation.content.text = "never read";
  host.contentCalls = 0;
  CHECK_EQ(layerHash(host, kLayerA), before);
  CHECK_EQ(host.contentCalls, 4);
}

TEST(content_digest_costs_nothing_without_hashing_or_content) {
  fake::Host host = contentScene();
  Walker plain(host, WalkOptions{});
  plain.readProject();
  CHECK_EQ(host.contentCalls, 0);
  CHECK_EQ(plain.contentNs(), int64_t(0));

  fake::Host bare = fake::makeScene();
  bare.comps[0].layers.erase(bare.comps[0].layers.begin());
  bare.comps[0].row.numLayers = 1;
  WalkOptions options;
  options.detail = Detail::Full;
  Walker walker(bare, options);
  walker.hashProject();
  CHECK_EQ(bare.contentCalls, 0);
  CHECK_EQ(walker.contentNs(), int64_t(0));
}

TEST(content_digest_time_is_part_of_the_hash_time) {
  fake::Host host = contentScene();
  WalkOptions options;
  options.detail = Detail::Full;
  Walker walker(host, options);
  walker.hashProject();
  CHECK(walker.contentNs() > 0);
  CHECK(walker.contentNs() <= walker.hashNs());
}

}
