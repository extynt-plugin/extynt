// File-based request and response exchange in a private folder; descriptor-relative and link-safe on POSIX.
#include "exchange_folder.h"

#include <cstddef>
#include <optional>
#include <string>
#include <utility>

#ifdef _WIN32
#include <filesystem>
#include <fstream>
#include <ios>
#include <iterator>
#include <system_error>
#else
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#include <cerrno>

#include "sdk_posix_open.h"
#endif

namespace extynt {

namespace {

constexpr const char* kRequestName = "request.json";
constexpr const char* kResponseName = "response.json";

}

ExchangeFolder::ExchangeFolder(ExchangeFolder&& other) noexcept
    : path_(std::move(other.path_)), handle_(std::exchange(other.handle_, -1)) {}

ExchangeFolder& ExchangeFolder::operator=(ExchangeFolder&& other) noexcept {
  if (this != &other) {
    release();
    path_ = std::move(other.path_);
    handle_ = std::exchange(other.handle_, -1);
  }
  return *this;
}

ExchangeFolder::~ExchangeFolder() { release(); }

#ifdef _WIN32

namespace {

namespace fs = std::filesystem;

bool plainFile(const fs::path& path) {
  std::error_code ec;
  const fs::file_status status = fs::symlink_status(path, ec);
  return !ec && fs::is_regular_file(status);
}

}

void ExchangeFolder::release() {}

std::optional<ExchangeFolder> ExchangeFolder::open(const std::string& path, std::string& why) {
  std::error_code ec;
  const fs::path folder = fs::u8path(path);
  fs::create_directory(folder, ec);
  const fs::file_status status = fs::symlink_status(folder, ec);
  if (ec || !fs::is_directory(status)) {
    why = "the exchange path is not a plain directory";
    return std::nullopt;
  }
  return ExchangeFolder(path, -1);
}

std::string ExchangeFolder::takeRequest(size_t maxBytes, std::string& why) const {
  const fs::path file = fs::u8path(path_) / kRequestName;
  std::error_code ec;
  if (!plainFile(file)) {
    why = fs::exists(fs::symlink_status(file, ec)) ? "the request file is not a plain file" : "there is no request";
    fs::remove(file, ec);
    return "";
  }
  const auto size = fs::file_size(file, ec);
  if (ec || size > maxBytes) {
    fs::remove(file, ec);
    why = "the request file is unreadable or over the size limit";
    return "";
  }
  std::string text(static_cast<size_t>(size) + 1, '\0');
  {
    std::ifstream in(file, std::ios::binary);
    in.read(text.data(), static_cast<std::streamsize>(text.size()));
    text.resize(static_cast<size_t>(in.gcount()));
  }
  fs::remove(file, ec);
  if (text.size() > maxBytes) {
    why = "the request file is over the size limit";
    return "";
  }
  return text;
}

bool ExchangeFolder::putResponse(const std::string& text, std::string& why) const {
  const fs::path file = fs::u8path(path_) / kResponseName;
  std::error_code ec;
  fs::remove(file, ec);
  std::ofstream out(file, std::ios::binary | std::ios::trunc);
  out << text;
  out.close();
  if (out.fail() || !plainFile(file)) {
    why = "cannot write the response";
    return false;
  }
  return true;
}

#else

namespace {

bool ownedByUs(const struct stat& info) { return info.st_uid == ::geteuid(); }

bool makePrivateDirectory(int handle, std::string& why) {
  struct stat info{};
  if (::fstat(handle, &info) != 0 || !S_ISDIR(info.st_mode) || !ownedByUs(info)) {
    why = "the exchange directory is not owned by this user";
    return false;
  }
  if ((info.st_mode & 077) != 0 && ::fchmod(handle, 0700) != 0) {
    why = "cannot make the exchange directory private";
    return false;
  }
  return true;
}

bool readAll(int fd, std::string& text, size_t size) {
  text.resize(size);
  size_t done = 0;
  while (done < size) {
    const ssize_t got = ::read(fd, text.data() + done, size - done);
    if (got < 0 && errno == EINTR) continue;
    if (got <= 0) return false;
    done += static_cast<size_t>(got);
  }
  return true;
}

bool writeAll(int fd, const std::string& text) {
  size_t done = 0;
  while (done < text.size()) {
    const ssize_t put = ::write(fd, text.data() + done, text.size() - done);
    if (put < 0 && errno == EINTR) continue;
    if (put <= 0) return false;
    done += static_cast<size_t>(put);
  }
  return true;
}

bool readPlainFile(int fd, size_t maxBytes, std::string& text) {
  struct stat info{};
  if (::fstat(fd, &info) != 0 || !S_ISREG(info.st_mode) || !ownedByUs(info) || info.st_nlink != 1) return false;
  if (info.st_size < 0 || static_cast<size_t>(info.st_size) > maxBytes) return false;
  return readAll(fd, text, static_cast<size_t>(info.st_size));
}

}

void ExchangeFolder::release() {
  if (handle_ >= 0) ::close(handle_);
  handle_ = -1;
}

std::optional<ExchangeFolder> ExchangeFolder::open(const std::string& path, std::string& why) {
  if (::mkdir(path.c_str(), 0700) != 0 && errno != EEXIST) {
    why = "cannot create the exchange directory";
    return std::nullopt;
  }
  const int handle = posix::openDirectoryNoFollow(path.c_str());
  if (handle < 0) {
    why = "the exchange path is not a plain directory";
    return std::nullopt;
  }
  if (!makePrivateDirectory(handle, why)) {
    ::close(handle);
    return std::nullopt;
  }
  return ExchangeFolder(path, handle);
}

std::string ExchangeFolder::takeRequest(size_t maxBytes, std::string& why) const {
  const int fd = posix::openReadOnlyNoFollowAt(handle_, kRequestName);
  if (fd < 0) {
    const bool missing = errno == ENOENT;
    if (!missing) ::unlinkat(handle_, kRequestName, 0);
    why = missing ? "there is no request" : "the request file is not a plain file";
    return "";
  }
  std::string text;
  const bool read = readPlainFile(fd, maxBytes, text);
  ::close(fd);
  ::unlinkat(handle_, kRequestName, 0);
  if (!read) {
    why = "the request file is not a plain file of this user within the size limit";
    return "";
  }
  return text;
}

bool ExchangeFolder::putResponse(const std::string& text, std::string& why) const {
  ::unlinkat(handle_, kResponseName, 0);
  const int fd = posix::createExclusiveAt(handle_, kResponseName);
  if (fd < 0) {
    why = "cannot create the response file";
    return false;
  }
  const bool written = writeAll(fd, text);
  ::close(fd);
  if (!written) why = "cannot write the response";
  return written;
}

#endif

}
