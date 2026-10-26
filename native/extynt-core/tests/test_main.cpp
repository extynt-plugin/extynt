// The test runner: runs every registered test, optionally filtered by name, and exits non-zero on a failure.
#include <algorithm>
#include <cstdio>
#include <exception>
#include <iostream>
#include <string>
#include <vector>

#include "testing.h"

namespace {

bool runOne(const testing::Registrar& test) {
  try {
    test.body()();
    std::cout << "ok   " << test.name() << "\n";
    return true;
  } catch (const testing::Failure& failure) {
    std::cout << "FAIL " << test.name() << "\n  " << failure.message << "\n";
  } catch (const std::exception& error) {
    std::cout << "FAIL " << test.name() << "\n  exception: " << error.what() << "\n";
  }
  return false;
}

void report(const char* what) noexcept {
  static_cast<void>(std::fputs("test runner failed: ", stderr));
  static_cast<void>(std::fputs(what, stderr));
  static_cast<void>(std::fputs("\n", stderr));
}

int runAll(int argc, char** argv) {
  const std::string filter = argc > 1 ? argv[1] : "";
  std::vector<const testing::Registrar*> tests;
  for (const testing::Registrar* test = testing::Registrar::first(); test != nullptr; test = test->next()) {
    if (filter.empty() || std::string(test->name()).find(filter) != std::string::npos) tests.push_back(test);
  }
  std::reverse(tests.begin(), tests.end());
  const auto ran = static_cast<int>(tests.size());
  const auto passed =
      static_cast<int>(std::count_if(tests.begin(), tests.end(), [](const auto* test) { return runOne(*test); }));
  std::cout << passed << "/" << ran << " passed\n";
  return passed == ran && ran > 0 ? 0 : 1;
}

}

int main(int argc, char** argv) {
  try {
    return runAll(argc, argv);
  } catch (const std::exception& error) {
    report(error.what());
  } catch (...) {
    report("unknown exception");
  }
  return 1;
}
