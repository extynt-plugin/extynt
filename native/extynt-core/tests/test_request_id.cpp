// Recovering the request id of a line that is refused before parsing (over the size limit).
#include <string>

#include "request.h"
#include "request_id.h"
#include "testing.h"

using namespace extynt;

namespace {

TEST(a_string_or_integer_id_at_the_top_level_is_recovered) {
  CHECK_EQ(recoverRequestId(R"({"id":"abc-1","token":"t","op":"ping"})"), std::string("abc-1"));
  CHECK_EQ(recoverRequestId(R"({ "id" : "7" , "op":"ping"})"), std::string("7"));
  CHECK_EQ(recoverRequestId(R"({"id":42,"op":"ping"})"), std::string("42"));
  CHECK_EQ(recoverRequestId(R"({"token":"a\"b","op":"host_call","id":"9"})"), std::string("9"));
}

TEST(nothing_is_recovered_when_the_id_is_absent_nested_or_unsafe) {
  CHECK_EQ(recoverRequestId(""), std::string(""));
  CHECK_EQ(recoverRequestId(R"({"op":"ping"})"), std::string(""));
  CHECK_EQ(recoverRequestId(R"({"args":{"id":"inner"},"op":"ping"})"), std::string(""));
  CHECK_EQ(recoverRequestId(R"({"op":"id","token":"id"})"), std::string(""));
  CHECK_EQ(recoverRequestId(R"({"id":"a\nb"})"), std::string(""));
  CHECK_EQ(recoverRequestId(R"({"id":"cut off)"), std::string(""));
  CHECK_EQ(recoverRequestId(R"({"id":12)"), std::string(""));
  CHECK_EQ(recoverRequestId(R"({"id":012,"op":"x"})"), std::string(""));
  CHECK_EQ(recoverRequestId(R"({"id":-3,"op":"x"})"), std::string(""));
  CHECK_EQ(recoverRequestId("{\"id\":\"" + std::string(kRequestIdMaxLength + 1, 'x') + "\"}"), std::string(""));
}

TEST(only_the_first_bytes_are_scanned) {
  const std::string late = std::string(R"({"pad":")") + std::string(kRequestIdScanBytes, 'x') + R"(","id":"late"})";
  CHECK_EQ(recoverRequestId(late), std::string(""));
}

TEST(a_request_over_the_limit_is_refused_with_its_own_id) {
  const std::string head = R"({"id":"big-1","token":"t","op":"host_call","args":")";
  const std::string line = head + std::string(kMaxRequestBytes, 'x') + "\"}";
  const ParsedRequest refused = parseRequest(line);
  CHECK(!refused.ok);
  CHECK_EQ(refused.errorCode, std::string("REQUEST_TOO_LARGE"));
  CHECK_EQ(refused.request.id, std::string("big-1"));
  CHECK_EQ(parseRequest(std::string(kMaxRequestBytes + 1, ' ')).request.id, std::string(""));
}

}
