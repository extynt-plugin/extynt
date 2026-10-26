// Minimal streaming JSON writer. No SDK includes: part of the pure core.
// Output matches what JSON.stringify would produce for the same data
// (control characters escaped, non-ASCII passed through as UTF-8, no spaces).
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace extynt {

// Shortest decimal text that parses back to exactly `value` (general format at 15, 16 then
// 17 significant digits, in the classic locale; integral values below 1e15 print as plain integers, -0 prints as 0).
// Non-finite values are the caller's problem: JsonWriter::num() writes null.
std::string formatDouble(double value);

class JsonWriter {
 public:
  explicit JsonWriter(std::string& out) : out_(&out) {}

  void beginObject();
  void endObject();
  void beginArray();
  void endArray();
  void key(std::string_view name);
  void str(std::string_view utf8);
  void num(double value);
  void integer(int64_t value);
  void boolean(bool value);
  void null();
  // Inserts already-serialized JSON as a value.
  void raw(std::string_view json);

  // key + value conveniences
  void field(std::string_view name, std::string_view utf8) {
    key(name);
    str(utf8);
  }
  void field(std::string_view name, const char* utf8) {
    key(name);
    str(utf8);
  }
  void fieldNum(std::string_view name, double value) {
    key(name);
    num(value);
  }
  void fieldInt(std::string_view name, int64_t value) {
    key(name);
    integer(value);
  }
  void fieldBool(std::string_view name, bool value) {
    key(name);
    boolean(value);
  }
  void fieldNull(std::string_view name) {
    key(name);
    null();
  }

 private:
  void beforeValue();

  std::string* out_;
  std::vector<char> needComma_;
  bool afterKey_ = false;
};

// Appends `utf8` as a quoted, escaped JSON string. Invalid UTF-8 bytes become U+FFFD.
void appendJsonString(std::string& out, std::string_view utf8);

// Converts a UTF-16 buffer (as AE hands out) to UTF-8. Lone surrogates become U+FFFD.
std::string utf16ToUtf8(const uint16_t* units, size_t count);

}
