// Tests for UTF-8 validation, eight-bit text decoding and revision parsing.
#include <cstdint>
#include <optional>
#include <string>

#include "host_reader.h"
#include "layer_rules.h"
#include "testing.h"
#include "text_decode.h"

using namespace extynt;

namespace {

std::string decode(const std::string& text) { return decodeEightBitText(text); }

bool validUtf8(const std::string& text) { return isValidUtf8(text); }

TEST(eight_bit_text_is_utf8_when_valid) {
  CHECK_EQ(decode("// Camera push: wiggle(2, 10)"), std::string("// Camera push: wiggle(2, 10)"));
  CHECK_EQ(decode("caf\xC3\xA9 \xE6\x97\xA5 \xF0\x9F\x98\x80"),
           std::string("caf\xC3\xA9 \xE6\x97\xA5 \xF0\x9F\x98\x80"));
  CHECK_EQ(decode(""), std::string(""));
}

TEST(eight_bit_text_falls_back_to_latin1) {
  CHECK_EQ(decode("caf\xE9"), std::string("caf\xC3\xA9"));
  CHECK_EQ(decode("\xFF"), std::string("\xC3\xBF"));
  CHECK_EQ(decode("a\xC0\x80"), std::string("a\xC3\x80\xC2\x80"));
  CHECK(!validUtf8("\xED\xA0\x80"));
  CHECK(!validUtf8("ab\xE6\x97"));
  CHECK_EQ(decode("ab\xE6\x97"), std::string("ab\xC3\xA6\xC2\x97"));
}

TEST(eight_bit_text_stops_at_nul_and_ignores_capacity_garbage) {
  const std::string padded("ab\0cd", 5);
  CHECK_EQ(decode(padded), std::string("ab"));
  const std::string slashes = "// x";
  CHECK_EQ(decodeEightBitText(slashes), std::string("// x"));
  const auto misread = static_cast<uint16_t>(slashes[0] | (slashes[1] << 8));
  CHECK_EQ(misread, static_cast<uint16_t>(0x2F2F));
}

TEST(revision_text_parses_only_plain_integers) {
  const std::optional<int64_t> parsedValue = parseRevisionText("1234");
  CHECK(parsedValue == 1234);
  const std::optional<int64_t> zero = parseRevisionText("0");
  CHECK(zero == 0);
  CHECK(!parseRevisionText("").has_value());
  CHECK(!parseRevisionText("undefined").has_value());
  CHECK(!parseRevisionText("12abc").has_value());
  CHECK(!parseRevisionText("-5").has_value());
  CHECK(!parseRevisionText("1.5").has_value());
  CHECK(!parseRevisionText("9999999999999999999999").has_value());
}

TEST(dom_layer_rules_for_camera_and_light) {
  for (const LayerType type : {LayerType::Camera, LayerType::Light}) {
    LayerRow row;
    row.type = type;
    row.threeD = true;
    row.switches.quality = std::string("WIREFRAME");
    row.switches.frameBlending = std::string("NO_FRAME_BLEND");
    row.switches.sampling = std::string("BILINEAR");
    row.switches.blendMode = std::string("NORMAL");
    row.switches.motionBlur = true;
    row.switches.collapseTransformation = true;
    row.switches.guideLayer = true;
    row.switches.adjustment = true;
    row.switches.effectsActive = true;
    applyDomLayerRules(row);
    CHECK(row.threeD == false);
    CHECK(!row.switches.quality && !row.switches.frameBlending && !row.switches.sampling && !row.switches.blendMode);
    CHECK(row.switches.motionBlur && *row.switches.motionBlur == false);
    CHECK(*row.switches.collapseTransformation == false && *row.switches.guideLayer == false);
    CHECK(*row.switches.adjustment == false && *row.switches.effectsActive == false);
  }
  LayerRow av;
  av.type = LayerType::Av;
  av.threeD = true;
  av.switches.quality = std::string("BEST");
  applyDomLayerRules(av);
  CHECK(av.threeD);
  CHECK_EQ(*av.switches.quality, std::string("BEST"));
}

TEST(enabled_from_raw_flags_matches_the_round_two_table) {
  CHECK(enabledFromDynFlags(1));
  CHECK(enabledFromDynFlags(9));
  CHECK(!enabledFromDynFlags(3));
  CHECK(!enabledFromDynFlags(10));
  CHECK(!enabledFromDynFlags(0));
  CHECK(enabledFromDynFlags(1 + 16));
}

}
