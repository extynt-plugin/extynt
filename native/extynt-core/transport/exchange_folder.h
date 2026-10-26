// The private folder the host jsx and the stream bridge pass request.json and response.json through; it is the bridge's
// trust boundary, so it is strict and has no SDK. The folder must be owned by this user, and POSIX tightens it to 0700
// when it is looser. POSIX opens every file relative to its handle without following links, as a plain single-link
// file of this user, size-capped, with the response created exclusively 0600. Windows relies on the per-user temp
// folder and refuses links and non-plain files.
#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <utility>

namespace extynt {

class ExchangeFolder {
 public:
  // Creates `path` if absent and checks it; nothing and a reason in `why` when it cannot be trusted.
  static std::optional<ExchangeFolder> open(const std::string& path, std::string& why);

  ExchangeFolder(ExchangeFolder&& other) noexcept;
  ExchangeFolder& operator=(ExchangeFolder&& other) noexcept;
  ExchangeFolder(const ExchangeFolder&) = delete;
  ExchangeFolder& operator=(const ExchangeFolder&) = delete;
  ~ExchangeFolder();

  // The text of request.json, which is removed once read; "" and a reason in `why` when there is none or it is unsafe.
  std::string takeRequest(size_t maxBytes, std::string& why) const;

  // Replaces response.json with `text`; false and a reason in `why` when it cannot be written safely.
  bool putResponse(const std::string& text, std::string& why) const;

 private:
  ExchangeFolder(std::string path, int handle) : path_(std::move(path)), handle_(handle) {}
  void release();

  std::string path_;
  int handle_ = -1;
};

}
