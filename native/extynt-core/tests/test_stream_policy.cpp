// What the stream bridge lets a request touch: only a Puppet pin's two hidden streams may be set, with bounded values,
// under a single-use token.
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "stream_policy.h"
#include "stream_request.h"
#include "testing.h"

using namespace extynt;

namespace {

std::vector<PathSegment> parsed(const std::string& path) {
  std::string problem;
  const std::optional<StreamRequest> request =
      decodeStreamRequest(R"({"ops":[{"op":"set","path":)" + path + "}]}", problem);
  if (!request || request->ops.empty()) throw testing::Failure{"bad path: " + path};
  return testing::need(request->ops.front().path, "a path");
}

std::string pinPath(const std::string& leaf) {
  return R"([{"match":"ADBE Effect Parade"},{"index":1},{"match":"ADBE FreePin3 ARAP Group"},)"
         R"({"match":"ADBE FreePin3 Mesh Group"},{"index":0},{"match":"ADBE FreePin3 PosPins"},{"index":2},)" +
         leaf + "]";
}

TEST(a_set_may_reach_only_the_two_pin_streams) {
  CHECK_EQ(settablePinStream(parsed(pinPath(R"({"match":"ADBE FreePin3 PosPin Vtx Offset"})"))),
           std::string("ADBE FreePin3 PosPin Vtx Offset"));
  CHECK_EQ(settablePinStream(parsed(pinPath(R"({"match":"ADBE FreePin3 PosPin Vtx Index"})"))),
           std::string("ADBE FreePin3 PosPin Vtx Index"));
  CHECK_EQ(settablePinStream(parsed(pinPath(R"({"match":"ADBE FreePin3 PosPin Position"})"))), std::string());
  CHECK_EQ(settablePinStream(parsed(R"([{"match":"ADBE Transform Group"},{"match":"ADBE Opacity"}])")), std::string());
}

TEST(a_pin_path_segment_cannot_carry_two_keys) {
  const std::string hijacked = pinPath(R"({"match":"ADBE FreePin3 PosPin Vtx Offset"})");
  std::string twoKeys = hijacked;
  twoKeys.replace(twoKeys.find(R"({"index":1})"), 11, R"({"index":1,"match":"ADBE Transform Group"})");
  CHECK_EQ(settablePinStream(parsed(twoKeys)), std::string());
  std::string fractional = hijacked;
  fractional.replace(fractional.find(R"({"index":1})"), 11, R"({"index":1.5})");
  CHECK_EQ(settablePinStream(parsed(fractional)), std::string());
  std::string negative = hijacked;
  negative.replace(negative.find(R"({"index":1})"), 11, R"({"index":-1})");
  CHECK_EQ(settablePinStream(parsed(negative)), std::string());
}

TEST(set_values_are_finite_and_bounded) {
  const double inf = std::numeric_limits<double>::infinity();
  CHECK(settableValuesInRange({0.0, -999999.0}, false));
  CHECK(!settableValuesInRange({1e9}, false));
  CHECK(!settableValuesInRange({inf}, false));
  CHECK(!settableValuesInRange({std::numeric_limits<double>::quiet_NaN()}, false));
}

TEST(a_vertex_index_is_whole_or_the_detached_marker) {
  CHECK(settableValuesInRange({0.0}, true));
  CHECK(settableValuesInRange({17.0}, true));
  CHECK(settableValuesInRange({4294967295.0}, true));
  CHECK(!settableValuesInRange({1.5}, true));
  CHECK(!settableValuesInRange({-1.0}, true));
  CHECK(!settableValuesInRange({4294967294.0}, true));
}

TEST(a_token_is_16_to_64_plain_characters) {
  CHECK(validBridgeToken("abcdefghijklmnop"));
  CHECK(validBridgeToken("abc-123_def.456-xyz"));
  CHECK(!validBridgeToken("short"));
  CHECK(!validBridgeToken(std::string(65, 'a')));
  CHECK(!validBridgeToken("abcdefghijklmno/../"));
  CHECK(!validBridgeToken("abcdefghijklmn p"));
}

TEST(a_token_is_good_once_and_the_ledger_stays_bounded) {
  TokenLedger ledger;
  CHECK(ledger.claim("token-one"));
  CHECK(!ledger.claim("token-one"));
  for (size_t i = 0; i < kBridgeMaxTokens; ++i) CHECK(ledger.claim("t" + std::to_string(i)));
  CHECK(ledger.claim("token-one"));
  CHECK(!ledger.claim("t" + std::to_string(kBridgeMaxTokens - 1)));
}

StreamRequest decoded(const std::string& text) {
  std::string problem;
  return testing::need(decodeStreamRequest(text, problem), "a request");
}

TEST(a_request_decodes_its_token_ids_and_operations) {
  const StreamRequest request = decoded(
      R"({"token":"abcdefghijklmnop","compId":2,"layerId":7,"ops":[{"op":"get","path":[{"match":"a"},{"index":3}]}]})");
  CHECK_EQ(request.token, std::string("abcdefghijklmnop"));
  CHECK_EQ(testing::need(request.compId, "compId"), 2);
  CHECK_EQ(testing::need(request.layerId, "layerId"), 7);
  CHECK_EQ(request.ops.size(), size_t{1});
  CHECK_EQ(request.ops[0].verb, std::string("get"));
  const std::vector<PathSegment>& path = testing::need(request.ops[0].path, "path");
  CHECK(std::get<MatchSegment>(path.at(0)).exclusive);
  CHECK_EQ(std::get<IndexSegment>(path.at(1)).index, uint32_t{3});
}

TEST(an_id_that_is_not_a_whole_number_in_range_decodes_to_nothing) {
  CHECK(!decoded(R"({"compId":-1,"layerId":1.5})").compId.has_value());
  CHECK(!decoded(R"({"compId":-1,"layerId":1.5})").layerId.has_value());
  CHECK(!decoded(R"({"compId":2147483648})").compId.has_value());
  CHECK(!decoded(R"({"compId":"2"})").compId.has_value());
}

TEST(a_path_outside_its_bounds_or_with_unusable_segments_is_kept_apart) {
  CHECK(!decoded(R"({"ops":[{"op":"get","path":[]}]})").ops.at(0).path.has_value());
  CHECK(!decoded(R"({"ops":[{"op":"get"}]})").ops.at(0).path.has_value());
  const std::string thirteen = R"({"index":0},{"index":0},{"index":0},{"index":0},{"index":0},{"index":0},)"
                               R"({"index":0},{"index":0},{"index":0},{"index":0},{"index":0},{"index":0},{"index":0})";
  CHECK(!decoded(R"({"ops":[{"op":"get","path":[)" + thirteen + R"(]}]})").ops.at(0).path.has_value());
  const StreamRequest odd = decoded(R"({"ops":[{"op":"get","path":[{"match":4},7,{"match":"m","index":1}]}]})");
  const std::vector<PathSegment>& path = testing::need(odd.ops.at(0).path, "path");
  CHECK(std::holds_alternative<UnusableSegment>(path.at(0)));
  CHECK(std::holds_alternative<UnusableSegment>(path.at(1)));
  CHECK(!std::get<MatchSegment>(path.at(2)).exclusive);
}

TEST(an_index_that_is_huge_negative_or_fractional_is_an_unusable_segment) {
  for (const char* index : {"1e300", "-1", "2147483648", "1.5"}) {
    const StreamRequest request = decoded(std::string(R"({"ops":[{"op":"get","path":[{"index":)") + index + R"(}]}]})");
    const std::vector<PathSegment>& path = testing::need(request.ops.at(0).path, "path");
    CHECK(std::holds_alternative<UnusableSegment>(path.at(0)));
  }
}

TEST(a_set_value_decodes_to_numbers_and_operations_stop_at_the_cap) {
  const StreamRequest request =
      decoded(R"({"ops":[{"op":"set","path":[{"index":0}],"value":[1,"x"]},{"op":"set","value":5},{"op":"get"}]})");
  CHECK_EQ(request.ops.size(), size_t{3});
  const std::vector<double>& numbers = testing::need(request.ops[0].value, "value");
  CHECK_EQ(numbers.size(), size_t{2});
  CHECK_EQ(numbers[0], 1.0);
  CHECK(std::isnan(numbers[1]));
  std::string ops;
  for (size_t i = 0; i < kBridgeMaxOps + 5; ++i) ops += R"({"op":"get"},)";
  ops.pop_back();
  CHECK_EQ(decoded(R"({"ops":[)" + ops + "]}").ops.size(), kBridgeMaxOps);
}

TEST(a_negative_index_is_rejected_when_the_request_is_decoded) {
  const StreamRequest request = decoded(R"({"ops":[{"op":"get","path":[{"index":-1}]}]})");
  const std::vector<PathSegment>& path = testing::need(request.ops.at(0).path, "path");
  CHECK(std::holds_alternative<UnusableSegment>(path.at(0)));
}

TEST(the_largest_whole_index_is_a_usable_segment) {
  const StreamRequest request = decoded(R"({"ops":[{"op":"get","path":[{"index":2147483647}]}]})");
  const std::vector<PathSegment>& path = testing::need(request.ops.at(0).path, "path");
  CHECK_EQ(std::get<IndexSegment>(path.at(0)).index, uint32_t{2147483647});
}

}
