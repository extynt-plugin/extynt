// Winsock implementation of net.h: loopback only, the same behaviour as net_posix.cpp.
#include <winsock2.h>
#include <ws2tcpip.h>

#include <algorithm>
#include <array>
#include <climits>
#include <cstddef>
#include <cstdint>
#include <string>
#include <system_error>

#include "net.h"
#include "sdk_winsock.h"

namespace extynt::net {

namespace {

std::string winsockText(int code) { return std::system_category().message(code); }

int startWinsock() {
  static const int result = [] {
    WSADATA data{};
    return ::WSAStartup(MAKEWORD(2, 2), &data);
  }();
  return result;
}

SOCKET toSocket(Handle handle) { return static_cast<SOCKET>(handle); }
Handle toHandle(SOCKET socket) { return static_cast<Handle>(socket); }

sockaddr_in loopbackAddress(int port) {
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  address.sin_port = htons(static_cast<u_short>(port));
  return address;
}

bool failWith(const char* step, int code, std::string& error) {
  error = std::string(step) + ": " + winsockText(code);
  return false;
}

SOCKET openSocket(std::string& error) {
  const int started = startWinsock();
  if (started != 0) {
    failWith("WSAStartup", started, error);
    return INVALID_SOCKET;
  }
  const SOCKET fd = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (fd == INVALID_SOCKET) failWith("socket", ::WSAGetLastError(), error);
  return fd;
}

bool bindAndListen(SOCKET fd, std::string& error) {
  const sockaddr_in address = loopbackAddress(0);
  if (::bind(fd, asSockaddr(address), sizeof address) != 0) {
    return failWith("bind", ::WSAGetLastError(), error);
  }
  if (::listen(fd, 8) != 0) return failWith("listen", ::WSAGetLastError(), error);
  return true;
}

bool boundPort(SOCKET fd, int& port, std::string& error) {
  sockaddr_in address{};
  int length = static_cast<int>(sizeof address);
  if (::getsockname(fd, asSockaddr(address), &length) != 0) {
    return failWith("getsockname", ::WSAGetLastError(), error);
  }
  port = ntohs(address.sin_port);
  return true;
}

int pollOne(SOCKET fd, short events, int timeoutMs, short& revents) {
  WSAPOLLFD waiting{};
  waiting.fd = fd;
  waiting.events = events;
  const int ready = ::WSAPoll(&waiting, 1, timeoutMs);
  revents = waiting.revents;
  return ready;
}

}

bool listenLoopback(Handle& listener, int& port, std::string& error) {
  const SOCKET fd = openSocket(error);
  if (fd == INVALID_SOCKET) return false;
  enableSocketFlag(fd, SOL_SOCKET, SO_EXCLUSIVEADDRUSE);
  if (!bindAndListen(fd, error) || !boundPort(fd, port, error)) {
    ::closesocket(fd);
    return false;
  }
  listener = toHandle(fd);
  return true;
}

bool connectLoopback(int port, Handle& client, std::string& error) {
  const SOCKET fd = openSocket(error);
  if (fd == INVALID_SOCKET) return false;
  const sockaddr_in address = loopbackAddress(port);
  if (::connect(fd, asSockaddr(address), sizeof address) != 0) {
    failWith("connect", ::WSAGetLastError(), error);
    ::closesocket(fd);
    return false;
  }
  client = toHandle(fd);
  return true;
}

Handle acceptClient(Handle listener, int timeoutMs, bool& timedOut) {
  timedOut = false;
  for (;;) {
    short revents = 0;
    const int ready = pollOne(toSocket(listener), POLLRDNORM, timeoutMs, revents);
    if (ready == 0) {
      timedOut = true;
      return kInvalidHandle;
    }
    if (ready < 0) return kInvalidHandle;
    const SOCKET fd = ::accept(toSocket(listener), nullptr, nullptr);
    if (fd != INVALID_SOCKET) {
      enableSocketFlag(fd, IPPROTO_TCP, TCP_NODELAY);
      return toHandle(fd);
    }
    const int code = ::WSAGetLastError();
    if (code == WSAECONNRESET || code == WSAECONNABORTED || code == WSAEINTR) continue;
    return kInvalidHandle;
  }
}

long receiveSome(Handle socket, char* buffer, size_t capacity) {
  const int limit = static_cast<int>(std::min<size_t>(capacity, INT_MAX));
  return static_cast<long>(::recv(toSocket(socket), buffer, limit, 0));
}

bool sendAll(Handle socket, const char* data, size_t size) {
  while (size > 0) {
    const int chunk = static_cast<int>(std::min<size_t>(size, INT_MAX));
    const int n = ::send(toSocket(socket), data, chunk, 0);
    if (n == SOCKET_ERROR) {
      if (::WSAGetLastError() == WSAEINTR) continue;
      return false;
    }
    data += n;
    size -= static_cast<size_t>(n);
  }
  return true;
}

bool peerClosed(Handle socket) {
  short revents = 0;
  const int ready = pollOne(toSocket(socket), POLLRDNORM, 0, revents);
  if (ready < 0) return true;
  if (ready == 0) return false;
  if ((revents & (POLLHUP | POLLERR | POLLNVAL)) != 0) return true;
  std::array<char, 512> discard{};
  const int n = ::recv(toSocket(socket), discard.data(), static_cast<int>(discard.size()), 0);
  if (n > 0) return false;
  return n == 0 || (::WSAGetLastError() != WSAEWOULDBLOCK && ::WSAGetLastError() != WSAEINTR);
}

void setSendTimeout(Handle socket, int timeoutMs) {
  setSendTimeoutMs(toSocket(socket), static_cast<DWORD>(timeoutMs < 0 ? 0 : timeoutMs));
}

void shutdownRead(Handle socket) { ::shutdown(toSocket(socket), SD_RECEIVE); }
void shutdownBoth(Handle socket) { ::shutdown(toSocket(socket), SD_BOTH); }
void closeHandle(Handle socket) { ::closesocket(toSocket(socket)); }

}
