// The sidecar side of the catalogue window: session.json and the engine requests over WinHTTP. See
// catalogue_engine_win.h.
#include "catalogue_engine_win.h"

#include <windows.h>
#include <winhttp.h>

#include <array>
#include <fstream>
#include <optional>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "windows_paths.h"

namespace extynt::catalogue {

namespace {

constexpr std::size_t kBodyCap = 4U << 20;
constexpr int kTimeoutMilliseconds = 10000;

std::optional<std::string> readFile(const std::string& utf8Path) {
  const std::ifstream stream(win::widen(utf8Path).c_str(), std::ios::binary);
  if (!stream) return std::nullopt;
  std::ostringstream text;
  text << stream.rdbuf();
  return text.str();
}

struct Internet {
  HINTERNET handle = nullptr;
  Internet() = default;
  explicit Internet(HINTERNET opened) : handle(opened) {}
  Internet(const Internet&) = delete;
  Internet& operator=(const Internet&) = delete;
  Internet(Internet&&) = delete;
  Internet& operator=(Internet&&) = delete;
  ~Internet() {
    if (handle) WinHttpCloseHandle(handle);
  }
};

bool sendEngineRequest(HINTERNET request, const SessionEndpoint& endpoint, bool post) {
  const std::wstring headers =
      L"Authorization: Bearer " + win::widen(endpoint.token) + L"\r\nContent-Type: application/json\r\n";
  static std::array<char, 3> emptyObject = {'{', '}', '\0'};
  const DWORD bodyLength = post ? 2 : 0;
  return WinHttpSendRequest(request, headers.c_str(), static_cast<DWORD>(headers.size()),
                            post ? static_cast<LPVOID>(emptyObject.data()) : WINHTTP_NO_REQUEST_DATA, bodyLength,
                            bodyLength, 0) != FALSE &&
         WinHttpReceiveResponse(request, nullptr) != FALSE;
}

std::optional<std::string> readBody(HINTERNET request) {
  std::string body;
  for (;;) {
    DWORD available = 0;
    if (WinHttpQueryDataAvailable(request, &available) == FALSE || available == 0) break;
    std::string chunk(available, '\0');
    DWORD read = 0;
    if (WinHttpReadData(request, chunk.data(), available, &read) == FALSE || read == 0) break;
    body.append(chunk, 0, read);
    if (body.size() > kBodyCap) return std::nullopt;
  }
  return body;
}

}

std::optional<SessionEndpoint> readSession() {
  const std::string directory = win::stateDirectoryPath();
  if (directory.empty()) return std::nullopt;
  const std::optional<std::string> text = readFile(directory + "/session.json");
  return text ? sessionEndpointFromJson(*text) : std::nullopt;
}

bool sessionMoved(const std::optional<SessionEndpoint>& known, const std::optional<SessionEndpoint>& latest) {
  return known && latest && (known->port != latest->port || known->token != latest->token);
}

std::optional<Status> requestEngine(const SessionEndpoint& endpoint, bool post) {
  const Internet session(WinHttpOpen(L"extynt-catalogue/1", WINHTTP_ACCESS_TYPE_NO_PROXY, WINHTTP_NO_PROXY_NAME,
                                     WINHTTP_NO_PROXY_BYPASS, 0));
  if (!session.handle) return std::nullopt;
  WinHttpSetTimeouts(session.handle, kTimeoutMilliseconds, kTimeoutMilliseconds, kTimeoutMilliseconds,
                     kTimeoutMilliseconds);
  const Internet connection(WinHttpConnect(session.handle, L"127.0.0.1", static_cast<INTERNET_PORT>(endpoint.port), 0));
  if (!connection.handle) return std::nullopt;
  const Internet request(WinHttpOpenRequest(connection.handle, post ? L"POST" : L"GET", L"/v1/catalogue/engine",
                                            nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, 0));
  if (!request.handle) return std::nullopt;
  if (!sendEngineRequest(request.handle, endpoint, post)) return std::nullopt;
  const std::optional<std::string> body = readBody(request.handle);
  if (!body) return std::nullopt;
  return parseResponse(*body);
}

void AnswerQueue::push(std::optional<Status> answer) {
  const std::scoped_lock guard(lock_);
  answers_.push_back(std::move(answer));
}

std::vector<std::optional<Status>> AnswerQueue::drain() {
  const std::scoped_lock guard(lock_);
  return std::exchange(answers_, {});
}

}
