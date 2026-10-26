// A fresh directory under the system temp folder, unique per process and call.
#pragma once

#include <unistd.h>

#include <atomic>
#include <filesystem>
#include <string>

namespace testing {

inline std::filesystem::path makeTempDir(const std::string& prefix) {
  static std::atomic<int> counter{0};
  const std::filesystem::path dir = std::filesystem::temp_directory_path() /
                                    (prefix + "-" + std::to_string(::getpid()) + "-" + std::to_string(counter++));
  std::filesystem::create_directories(dir);
  return dir;
}

}
