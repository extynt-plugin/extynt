// Tiny test harness: no dependencies. Each TEST registers itself in an intrusive list at static-init time
// (noexcept, no allocation); main() walks the list. Test files wrap their tests in an anonymous namespace.
#pragma once

#include <cmath>
#include <iostream>
#include <optional>
#include <sstream>
#include <string>

namespace testing {

struct Failure {
  std::string message;
};

class Registrar {
 public:
  using Body = void (*)();

  Registrar(const char* testName, Body testBody) noexcept : name_(testName), body_(testBody), next_(head()) {
    head() = this;
  }

  [[nodiscard]] const char* name() const noexcept { return name_; }
  [[nodiscard]] Body body() const noexcept { return body_; }
  // Newest first: registration pushes at the front.
  [[nodiscard]] const Registrar* next() const noexcept { return next_; }
  [[nodiscard]] static const Registrar* first() noexcept { return head(); }

 private:
  static const Registrar*& head() noexcept {
    static const Registrar* list = nullptr;
    return list;
  }

  const char* name_;
  Body body_;
  const Registrar* next_;
};

// Where a comparison is written: the file, line and source text a failure reports.
struct Site {
  const char* file;
  int line;
  const char* text;
};

inline void check(bool ok, const char* file, int line, const char* condition) {
  if (!ok) throw Failure{std::string(file) + ":" + std::to_string(line) + ": CHECK(" + condition + ")"};
}

// Both operands are bound as arguments, so temporaries (and references into them) live until the comparison is done.
template <typename Actual, typename Expected>
void checkEqual(const Actual& actual, const Expected& expected, const Site& site) {
  if (actual == expected) return;
  std::ostringstream stream;
  stream << site.file << ":" << site.line << ": " << site.text << "\n  actual:   " << actual
         << "\n  expected: " << expected;
  throw Failure{stream.str()};
}

// The value of `option`; a test that expected one fails instead of reading an empty optional.
template <typename T>
const T& need(const std::optional<T>& option, const char* what) {
  if (!option) throw Failure{std::string("expected a value: ") + what};
  return *option;
}

}

#define TEST(name)                                               \
  void test_##name();                                            \
  const testing::Registrar registrar_##name(#name, test_##name); \
  void test_##name()

#define CHECK(condition) testing::check((condition), __FILE__, __LINE__, #condition)

#define CHECK_EQ(actual, expected) \
  testing::checkEqual((actual), (expected), testing::Site{__FILE__, __LINE__, #actual " == " #expected})
