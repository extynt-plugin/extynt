// Tests for hashing, JSON writing and UTF-16 conversion.
#include <array>
#include <cstdlib>
#include <cstdint>
#include <cstddef>
#include <fstream>
#include <functional>
#include <limits>
#include <sstream>
#include <string>
#include <vector>

#include "hash128.h"
#include "json_probe.h"
#include "json_writer.h"
#include "path_segments.h"
#include "request.h"
#include "testing.h"

using namespace extynt;

namespace {

TEST(hash_known_vectors) {
  CHECK_EQ(hashText("").hex(), std::string("99aa06d3014798d86001c324468d497f"));
  CHECK_EQ(hashText("a").hex(), std::string("a96faf705af16834e6c632b61e964e1f"));
  CHECK_EQ(hashText("abc").hex(), std::string("06b05ab6733a618578af5f94892f3950"));
  CHECK_EQ(hashText("hello world").hex(), std::string("df8d09e93f874900a99b8775cc15b6c7"));
  CHECK_EQ(hashText(std::string(17, 'x')).hex(), std::string("9e8a29b5dfc13013416e526dfb687d89"));
  CHECK_EQ(hashText(std::string(129, 'x')).hex(), std::string("e7f1abc92bce4135ae9ec8f29e5baa27"));
  CHECK_EQ(hashText(std::string(241, 'x')).hex(), std::string("586c2f1b13edf30f14da9e5c301a6a1d"));
  CHECK_EQ(hashText(std::string(1000, 'x')).hex(), std::string("50a1af5a5f2dcf01c0a4877b962cba82"));
  std::string bytes;
  for (int round = 0; round < 4; ++round)
    for (int i = 0; i < 256; ++i) bytes += static_cast<char>(i);
  CHECK_EQ(hashText(bytes).hex(), std::string("83885e853bb6640ca870f92984398d22"));
}

TEST(hash_streaming_matches_one_shot) {
  Hasher hasher;
  hasher.update("abc");
  hasher.update("def");
  CHECK_EQ(hasher.digest().hex(), std::string("389197a55db2b2e4da35a6714d34f8a2"));
  CHECK(hasher.digest() == hashText("abcdef"));
}

TEST(hash_merkle_child_feed_is_big_endian_digest) {
  const Hash128 child = hashText("child");
  Hasher a;
  a.update(child);
  std::string bytes;
  for (int i = 0; i < 8; ++i) bytes += static_cast<char>(child.high >> (56 - (8 * i)));
  for (int i = 0; i < 8; ++i) bytes += static_cast<char>(child.low >> (56 - (8 * i)));
  CHECK(a.digest() == hashText(bytes));
  CHECK(child.hex().size() == 32);
}

std::string written(const std::function<void(JsonWriter&)>& body) {
  std::string text;
  JsonWriter writer(text);
  body(writer);
  return text;
}

TEST(json_writer_structure_and_commas) {
  const std::string text = written([](JsonWriter& w) {
    w.beginObject();
    w.field("a", "x");
    w.key("b");
    w.beginArray();
    w.integer(1);
    w.num(2.5);
    w.null();
    w.beginObject();
    w.endObject();
    w.endArray();
    w.fieldBool("c", true);
    w.key("d");
    w.raw("{\"k\":1}");
    w.endObject();
  });
  CHECK_EQ(text, std::string("{\"a\":\"x\",\"b\":[1,2.5,null,{}],\"c\":true,\"d\":{\"k\":1}}"));
}

TEST(json_string_escaping_matches_json_stringify) {
  std::string out;
  appendJsonString(out, std::string("q\"b\\s/\b\f\n\r\t\x01\x1f") + "é日本\xF0\x9F\x98\x80");
  CHECK_EQ(out, std::string("\"q\\\"b\\\\s/\\b\\f\\n\\r\\t\\u0001\\u001fé日本\xF0\x9F\x98\x80\""));
  std::string bad;
  appendJsonString(bad, std::string("a\xFF"
                                    "b\xC0\x80"
                                    "c"));
  CHECK_EQ(bad, std::string("\"a\xEF\xBF\xBD"
                            "b\xEF\xBF\xBD\xEF\xBF\xBD"
                            "c\""));
}

TEST(json_number_formatting) {
  CHECK_EQ(formatDouble(0), std::string("0"));
  CHECK_EQ(formatDouble(-0.0), std::string("0"));
  CHECK_EQ(formatDouble(100), std::string("100"));
  CHECK_EQ(formatDouble(-2.5), std::string("-2.5"));
  CHECK_EQ(formatDouble(0.1), std::string("0.1"));
  CHECK_EQ(formatDouble(1.0 / 3.0), std::string("0.3333333333333333"));
  CHECK_EQ(formatDouble(1e21), std::string("1e+21"));
  CHECK_EQ(formatDouble(123456789.125), std::string("123456789.125"));
  std::string text;
  JsonWriter w(text);
  w.beginArray();
  w.num(std::numeric_limits<double>::quiet_NaN());
  w.num(std::numeric_limits<double>::infinity());
  w.endArray();
  CHECK_EQ(text, std::string("[null,null]"));
  for (const double v : {0.1, 29.97, 1.0 / 7.0, 123456.789e-9, 5e-324, 1.7976931348623157e308}) {
    CHECK_EQ(std::strtod(formatDouble(v).c_str(), nullptr), v);
  }
}

TEST(json_number_boundaries) {
  CHECK_EQ(formatDouble(0.1), std::string("0.1"));
  CHECK_EQ(formatDouble(1e-7), std::string("1e-07"));
  CHECK_EQ(formatDouble(1.7976931348623157e308), std::string("1.7976931348623157e+308"));
  CHECK_EQ(formatDouble(999999999999999.0), std::string("999999999999999"));
  CHECK_EQ(formatDouble(1e15), std::string("1e+15"));
  CHECK_EQ(formatDouble(1e15 + 0.5), std::string("1000000000000000.5"));
  CHECK_EQ(formatDouble(1e16), std::string("1e+16"));
  CHECK_EQ(formatDouble(-1e-7), std::string("-1e-07"));
}

TEST(utf16_conversion) {
  const std::array<uint16_t, 2> ascii = {'h', 'i'};
  CHECK_EQ(utf16ToUtf8(ascii.data(), ascii.size()), std::string("hi"));
  const std::array<uint16_t, 4> mixed = {0x00E9, 0x65E5, 0xD83D, 0xDE00};
  CHECK_EQ(utf16ToUtf8(mixed.data(), mixed.size()), std::string("é日\xF0\x9F\x98\x80"));
  const std::array<uint16_t, 2> lone = {0xD83D, 'x'};
  CHECK_EQ(utf16ToUtf8(lone.data(), lone.size()), std::string("\xEF\xBF\xBD"
                                                              "x"));
}

TEST(json_parse_roundtrip_and_errors) {
  JsonValue v;
  std::string error;
  CHECK(parseJson("{\"a\":[1,-2.5e1,\"x\\u00e9\\ud83d\\ude00\",true,null],\"b\":{}}", v, error));
  CHECK(v.isObject());
  const JsonValue* a = v.find("a");
  CHECK(a && a->isArray() && a->items.size() == 5);
  CHECK_EQ(a->items[1].number, -25.0);
  CHECK_EQ(a->items[2].text, std::string("xé\xF0\x9F\x98\x80"));
  CHECK(!parseJson("{\"a\":}", v, error));
  CHECK(!parseJson("[1,2", v, error));
  CHECK(!parseJson("{} x", v, error));
  CHECK(!parseJson("[01x]", v, error));
  CHECK(!parseJson(std::string(40, '[') + std::string(40, ']'), v, error));
}

TEST(path_encode_matches_probe_vectors) {
  const std::ifstream file(EXTYNT_VECTORS_DIR "/path_segments.json");
  CHECK(file.good());
  std::stringstream buffer;
  buffer << file.rdbuf();
  JsonValue doc;
  std::string error;
  CHECK(parseJson(buffer.str(), doc, error));
  const JsonValue* list = doc.find("encode");
  CHECK(list && list->isArray() && list->items.size() >= 10);
  for (const JsonValue& item : list->items) {
    const std::string input = item.find("input")->text;
    const std::string expected = item.find("encoded")->text;
    CHECK_EQ(encodePathSegment(input), expected);
    CHECK_EQ(decodePathSegment(expected), input);
  }
}

TEST(path_encode_order_percent_first) {
  CHECK_EQ(encodePathSegment("%2F"), std::string("%252F"));
  CHECK_EQ(encodePathSegment("a/b#c%d"), std::string("a%2Fb%23c%25d"));
  CHECK_EQ(decodePathSegment("100%25%2F%23"), std::string("100%/#"));
  CHECK_EQ(decodePathSegment("%252F"), std::string("%2F"));
}

TEST(path_siblings_get_hash_n) {
  SiblingSegments seen;
  CHECK_EQ(seen.next("A", ""), std::string("A"));
  CHECK_EQ(seen.next("B", ""), std::string("B"));
  CHECK_EQ(seen.next("A", ""), std::string("A#2"));
  CHECK_EQ(seen.next("A", ""), std::string("A#3"));
  CHECK_EQ(seen.next("B", ""), std::string("B#2"));
  CHECK_EQ(seen.next("", "Fallback Name"), std::string("Fallback Name"));
  CHECK_EQ(seen.next("", ""), std::string("unknown"));
  CHECK_EQ(seen.next("dropShadow/mode2", ""), std::string("dropShadow%2Fmode2"));
  CHECK_EQ(seen.next("dropShadow/mode2", ""), std::string("dropShadow%2Fmode2#2"));
  CHECK_EQ(seen.next("A#2", ""), std::string("A%232"));
}

TEST(path_root_order_puts_transform_first) {
  const std::vector<std::string> names = {"ADBE Marker", "ADBE Effect Parade", "ADBE Transform Group",
                                          "ADBE Material Options Group"};
  const std::vector<size_t> order = rootVisitOrder(names);
  CHECK((order == std::vector<size_t>{2, 0, 1, 3}));
  CHECK((rootVisitOrder({"A", "B"}) == std::vector<size_t>{0, 1}));
}

TEST(path_parse) {
  std::vector<PathSegment> segments;
  CHECK(parsePath("ADBE Transform Group/ADBE Position", segments));
  CHECK_EQ(segments.size(), size_t(2));
  CHECK_EQ(segments[1].encodedBase, std::string("ADBE Position"));
  CHECK_EQ(segments[1].occurrence, 1);
  CHECK(parsePath("ADBE Effect Parade/ADBE Gaussian Blur 2#3/ADBE Gaussian Blur 2-0001", segments));
  CHECK_EQ(segments[1].encodedBase, std::string("ADBE Gaussian Blur 2"));
  CHECK_EQ(segments[1].occurrence, 3);
  CHECK(parsePath("a%23b/dropShadow%2Fmode2#2", segments));
  CHECK_EQ(segments[0].encodedBase, std::string("a%23b"));
  CHECK_EQ(segments[1].encodedBase, std::string("dropShadow%2Fmode2"));
  CHECK(!parsePath("", segments));
  CHECK(!parsePath("a//b", segments));
  CHECK(!parsePath("a/", segments));
  CHECK(!parsePath("a#", segments));
  CHECK(!parsePath("a#1", segments));
  CHECK(!parsePath("a#x", segments));
}

TEST(request_defaults_and_ops) {
  ParsedRequest r = parseRequest(R"({"id":7,"token":"t","op":"read_project"})");
  CHECK(r.ok);
  CHECK_EQ(r.request.id, std::string("7"));
  CHECK(r.request.detail == Detail::Structure);
  CHECK_EQ(r.request.maxPropertiesPerLayer, int64_t(0));
  r = parseRequest(R"({"op":"read_comp","compId":12,"detail":"full","maxPropertiesPerLayer":50,"hashes":true})");
  CHECK(r.ok);
  CHECK_EQ(r.request.compId, std::string("12"));
  CHECK(r.request.detail == Detail::Full);
  CHECK_EQ(r.request.maxPropertiesPerLayer, int64_t(50));
  CHECK(r.request.hashes);
  r = parseRequest(
      R"({"op":"read_paths","targets":[{"compId":"3","layerId":9,"path":"ADBE Transform Group/ADBE Position"}]})");
  CHECK(r.ok);
  CHECK_EQ(r.request.targets.size(), size_t(1));
  CHECK_EQ(r.request.targets[0].layerId, std::string("9"));
  CHECK(parseRequest("{\"op\":\"ping\"}").ok);
  CHECK(parseRequest("{\"op\":\"ping_direct\"}").request.op == Op::PingDirect);
  CHECK(parseRequest("{\"op\":\"hash_project\",\"propertyHashes\":true}").request.propertyHashes);
}

TEST(request_rejections) {
  CHECK_EQ(parseRequest("not json").errorCode, std::string("BAD_JSON"));
  CHECK_EQ(parseRequest("[1]").errorCode, std::string("BAD_REQUEST"));
  CHECK_EQ(parseRequest("{\"op\":\"nope\"}").errorCode, std::string("UNKNOWN_OP"));
  CHECK_EQ(parseRequest("{\"op\":\"read_comp\"}").errorCode, std::string("BAD_REQUEST"));
  CHECK_EQ(parseRequest("{\"op\":\"read_paths\",\"targets\":[]}").errorCode, std::string("BAD_REQUEST"));
  CHECK_EQ(parseRequest("{\"op\":\"read_paths\",\"targets\":[{\"compId\":1}]}").errorCode, std::string("BAD_REQUEST"));
  CHECK_EQ(parseRequest("{\"op\":\"read_project\",\"detail\":\"huge\"}").errorCode, std::string("BAD_REQUEST"));
  CHECK_EQ(parseRequest("{\"op\":\"read_project\",\"maxPropertiesPerLayer\":-1}").errorCode,
           std::string("BAD_REQUEST"));
  CHECK_EQ(parseRequest(std::string(kMaxRequestBytes + 1, ' ')).errorCode, std::string("REQUEST_TOO_LARGE"));
}

}
