// The Winsock conversions of sdk_winsock.h.
#include "sdk_winsock.h"

#include <winsock2.h>
#include <ws2tcpip.h>

#include <optional>

namespace extynt::net {

const sockaddr* asSockaddr(const sockaddr_in& address) { return reinterpret_cast<const sockaddr*>(&address); }

const sockaddr* asSockaddr(const sockaddr_in6& address) { return reinterpret_cast<const sockaddr*>(&address); }

sockaddr* asSockaddr(sockaddr_in& address) { return reinterpret_cast<sockaddr*>(&address); }

std::optional<sockaddr_in> asSockaddrIn(const sockaddr& name, int length) {
  if (name.sa_family != AF_INET || length < static_cast<int>(sizeof(sockaddr_in))) return std::nullopt;
  return *reinterpret_cast<const sockaddr_in*>(&name);
}

std::optional<sockaddr_in6> asSockaddrIn6(const sockaddr& name, int length) {
  if (name.sa_family != AF_INET6 || length < static_cast<int>(sizeof(sockaddr_in6))) return std::nullopt;
  return *reinterpret_cast<const sockaddr_in6*>(&name);
}

void enableSocketFlag(SOCKET socket, int level, int option) {
  const BOOL on = TRUE;
  ::setsockopt(socket, level, option, reinterpret_cast<const char*>(&on), static_cast<int>(sizeof on));
}

void setSendTimeoutMs(SOCKET socket, DWORD milliseconds) {
  ::setsockopt(socket, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char*>(&milliseconds),
               static_cast<int>(sizeof milliseconds));
}

}
