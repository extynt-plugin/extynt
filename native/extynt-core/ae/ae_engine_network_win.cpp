// The catalogue engine's network guard (Windows): in the hidden engine only, a bind to a network address with a fixed
// port is moved to loopback so Windows Firewall has nothing to ask about "Adobe After Effects". It redirects ws2_32's
// bind export and every module's import of it, and pins this plug-in and ws2_32 so the guard's code outlives every
// caller. A bind to port 0 is a client socket and is left alone, and the guard never runs in the After Effects the user
// works in.
#include <winsock2.h>
#include <ws2ipdef.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <tlhelp32.h>

#include <atomic>
#include <optional>
#include <string>

#include "ae_log.h"
#include "ae_platform.h"
#include "sdk_win_image.h"
#include "sdk_win_module.h"
#include "sdk_win_socket.h"
#include "sdk_winsock.h"

namespace extynt::ae {

namespace {

using sdkwin::BindFunction;

BindFunction& originalBind() {
  static BindFunction bind = nullptr;
  return bind;
}

std::atomic<int>& movedCount() {
  static std::atomic<int> moved{0};
  return moved;
}
constexpr int kLoggedMoves = 8;

bool isLoopback(const sockaddr_in& address) { return (ntohl(address.sin_addr.s_addr) >> 24) == 127; }
bool isLoopback(const sockaddr_in6& address) { return IN6_IS_ADDR_LOOPBACK(&address.sin6_addr) != FALSE; }

void noteMove(unsigned short port) {
  const int moved = ++movedCount();
  if (moved <= kLoggedMoves) {
    logLine("engine: kept a plug-in's listener on this computer (port " + std::to_string(port) +
            "), so Windows Firewall does not ask about After Effects");
  }
}

struct BindCall {
  SOCKET socket;
  const sockaddr* name;
  int length;
};

bool bindLoopback4(const BindCall& call, int& result) {
  std::optional<sockaddr_in> found = net::asSockaddrIn(*call.name, call.length);
  if (!found) return false;
  sockaddr_in& address = *found;
  if (address.sin_port == 0 || isLoopback(address)) return false;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  noteMove(ntohs(address.sin_port));
  result = originalBind()(call.socket, net::asSockaddr(address), sizeof(address));
  return true;
}

bool bindLoopback6(const BindCall& call, int& result) {
  std::optional<sockaddr_in6> found = net::asSockaddrIn6(*call.name, call.length);
  if (!found) return false;
  sockaddr_in6& address = *found;
  if (address.sin6_port == 0 || isLoopback(address)) return false;
  address.sin6_addr = in6addr_loopback;
  noteMove(ntohs(address.sin6_port));
  result = originalBind()(call.socket, net::asSockaddr(address), sizeof(address));
  return true;
}

int WSAAPI loopbackBind(SOCKET socket, const sockaddr* name, int length) {
  int result = SOCKET_ERROR;
  const BindCall call{socket, name, length};
  if (name != nullptr && (bindLoopback4(call, result) || bindLoopback6(call, result))) return result;
  return originalBind()(socket, name, length);
}

int redirectImports(HMODULE module) {
  int changed = 0;
  for (ULONG_PTR* slot : sdkwin::PeImage(module).importSlots("ws2_32.dll")) {
    if (sdkwin::replaceImport(slot, originalBind(), &loopbackBind)) ++changed;
  }
  return changed;
}

int redirectLoadedImports() {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, GetCurrentProcessId());
  if (snapshot == INVALID_HANDLE_VALUE) return 0;
  int changed = 0;
  MODULEENTRY32W module{};
  module.dwSize = sizeof(module);
  for (BOOL more = Module32FirstW(snapshot, &module); more != FALSE; more = Module32NextW(snapshot, &module)) {
    changed += redirectImports(module.hModule);
  }
  CloseHandle(snapshot);
  return changed;
}

bool pinModules(HMODULE& ws2) {
  return sdkwin::pinModuleContaining(&loopbackBind) && LoadLibraryW(L"ws2_32.dll") != nullptr &&
         GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_PIN, L"ws2_32.dll", &ws2) != FALSE;
}

bool redirectBindExport(HMODULE ws2) {
  const sdkwin::PeImage image(ws2);
  DWORD* const slot = image.exportSlot("bind");
  if (slot == nullptr) return false;
  const std::optional<DWORD> stub = sdkwin::allocateJumpStubNear(image, &loopbackBind);
  return stub && sdkwin::writeProtected(slot, *stub);
}

}

void keepEngineListenersLocal() {
  static bool started = false;
  if (started) return;
  started = true;
  HMODULE ws2 = nullptr;
  if (!pinModules(ws2)) {
    logLine("engine: network guard not started (a module could not be pinned)");
    return;
  }
  originalBind() = sdkwin::exportedBind(ws2);
  if (originalBind() == nullptr || !redirectBindExport(ws2)) {
    logLine("engine: network guard not started (ws2_32's bind could not be redirected)");
    return;
  }
  const int imports = redirectLoadedImports();
  logLine("engine: network guard on (" + std::to_string(imports) + " loaded import(s) redirected)");
}

}
