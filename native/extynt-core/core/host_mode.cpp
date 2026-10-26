// Which kind of After Effects process this is and which requests the catalogue engine may serve.
#include "host_mode.h"

#include <algorithm>
#include <cctype>
#include <cstddef>
#include <string>
#include <vector>

#include "host_entries.h"
#include "request.h"

namespace extynt {

namespace {

constexpr size_t kAppSuffixLength = 4;

std::string lowered(std::string text) {
  std::transform(text.begin(), text.end(), text.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return text;
}

bool openToEveryHost(const Request& request) {
  switch (request.op) {
    case Op::Ping:
    case Op::PingDirect:
    case Op::Revision:
    case Op::Watch:
    case Op::WatchState: return true;
    case Op::HostCall: return request.entry == HostEntry::UndoPlan || request.entry == HostEntry::DiscardCaptureFrame;
    default: return false;
  }
}

}

bool headlessHost(const std::vector<std::string>& arguments) {
  return std::any_of(arguments.begin(), arguments.end(),
                     [](const std::string& argument) { return lowered(argument) == "-extynt_engine"; });
}

bool engineEnvironment(const std::string& value) { return value == "1"; }

bool claimsEngineProbe(const Request& request) {
  if (request.op == Op::Batch) {
    return std::any_of(request.batch.begin(), request.batch.end(),
                       [](const Request& item) { return claimsEngineProbe(item); });
  }
  return request.claimsEngine;
}

bool engineRequestAllowed(const Request& request) {
  if (request.op == Op::Batch) {
    return std::all_of(request.batch.begin(), request.batch.end(),
                       [](const Request& item) { return engineRequestAllowed(item); });
  }
  if (openToEveryHost(request)) return true;
  if (request.op != Op::HostCall) return false;
  return request.entry == HostEntry::HostCensus || request.entry == HostEntry::CatalogueProbePage ||
         request.entry == HostEntry::CatalogueReadInstance;
}

std::string outerAppBundle(const std::string& bundlePath) {
  static const std::string kNested = ".app/Contents/";
  const size_t at = bundlePath.find(kNested);
  if (at == std::string::npos || at + kNested.size() >= bundlePath.size()) return bundlePath;
  return bundlePath.substr(0, at + kAppSuffixLength);
}

}
