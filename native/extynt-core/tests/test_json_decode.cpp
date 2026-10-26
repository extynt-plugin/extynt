// The typed JSON readers: each returns nothing for an absent member or one of another type, and the document reader
// tells a syntax error from valid JSON that is not an object.
#include <cstddef>
#include <cstdint>
#include <string>

#include "json_decode.h"
#include "testing.h"

using namespace extynt;

namespace {

JsonObject objectOf(const std::string& text) {
  const ObjectDocument document = readObjectDocument(text);
  return testing::need(document.object, "an object");
}

TEST(a_member_of_another_type_reads_as_nothing) {
  const JsonObject object = objectOf(R"({"s":"x","n":2.5,"b":true,"o":{},"a":[]})");
  CHECK_EQ(testing::need(object.string("s"), "s"), std::string("x"));
  CHECK_EQ(testing::need(object.number("n"), "n"), 2.5);
  CHECK(testing::need(object.boolean("b"), "b"));
  CHECK(object.object("o").has_value());
  CHECK(object.array("a").has_value());
  CHECK(!object.string("n").has_value());
  CHECK(!object.number("s").has_value());
  CHECK(!object.boolean("s").has_value());
  CHECK(!object.object("a").has_value());
  CHECK(!object.array("o").has_value());
  CHECK(!object.string("missing").has_value());
}

TEST(has_tells_an_absent_member_from_one_of_another_type) {
  const JsonObject object = objectOf(R"({"n":1,"nothing":null})");
  CHECK(object.has("n"));
  CHECK(object.has("nothing"));
  CHECK(!object.has("missing"));
  CHECK_EQ(object.memberCount(), size_t{2});
}

TEST(an_integer_is_a_whole_number_inside_its_range) {
  const JsonObject object = objectOf(R"({"in":5,"low":-1,"high":11,"fraction":5.5,"text":"5"})");
  const IntegerRange range{0, 10};
  CHECK_EQ(testing::need(object.integer("in", range), "in"), int64_t{5});
  CHECK(!object.integer("low", range).has_value());
  CHECK(!object.integer("high", range).has_value());
  CHECK(!object.integer("fraction", range).has_value());
  CHECK(!object.integer("text", range).has_value());
}

TEST(array_elements_read_by_position_and_type) {
  const JsonObject object = objectOf(R"({"a":["x",3,{"k":1}]})");
  const JsonArray list = testing::need(object.array("a"), "a");
  CHECK_EQ(list.size(), size_t{3});
  CHECK_EQ(testing::need(list.stringAt(0), "0"), std::string("x"));
  CHECK(!list.numberAt(0).has_value());
  CHECK_EQ(testing::need(list.numberAt(1), "1"), 3.0);
  CHECK(!list.objectAt(1).has_value());
  CHECK(testing::need(list.objectAt(2), "2").has("k"));
}

TEST(a_view_keeps_the_document_alive) {
  const JsonArray list = testing::need(objectOf(R"({"a":[{"k":"v"}]})").array("a"), "a");
  const JsonObject first = testing::need(list.objectAt(0), "0");
  CHECK_EQ(testing::need(first.string("k"), "k"), std::string("v"));
}

TEST(a_document_that_is_not_an_object_is_told_from_one_that_is_not_json) {
  const ObjectDocument notJson = readObjectDocument("{\"a\":");
  CHECK(!notJson.object.has_value());
  CHECK(!notJson.syntaxError.empty());
  const ObjectDocument array = readObjectDocument("[1]");
  CHECK(!array.object.has_value());
  CHECK(array.syntaxError.empty());
  CHECK(readObjectDocument("{}").object.has_value());
}

}
