// POSIX implementation of net.h: loopback only.
#include "net.h"

#include <array>
#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <string>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/types.h>
#include <unistd.h>

#include "errno_text.h"
#include "sdk_posix_socket.h"

namespace extynt::net {

namespace {

enum class Readiness : uint8_t { Ready, TimedOut, Failed };

Readiness waitReadable(Handle listener, int timeoutMs) {
  for (;;) {
    pollfd waiting{};
    waiting.fd = listener;
    waiting.events = POLLIN;
    const int ready = ::poll(&waiting, 1, timeoutMs);
    if (ready == 0) return Readiness::TimedOut;
    if (ready > 0) return Readiness::Ready;
    if (errno != EINTR) return Readiness::Failed;
  }
}

void tuneAccepted(Handle fd) {
  int yes = 1;
  ::setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &yes, sizeof yes);
#ifdef SO_NOSIGPIPE
  ::setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, sizeof yes);
#endif
}

bool discardedOrClosed(Handle socket) {
  std::array<char, 512> discard{};
  const ssize_t n = ::recv(socket, discard.data(), discard.size(), MSG_DONTWAIT);
  if (n > 0) return false;
  return n == 0 || (errno != EAGAIN && errno != EINTR);
}

sockaddr_in loopbackAddress(int port) {
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  address.sin_port = htons(static_cast<uint16_t>(port));
  return address;
}

}

bool listenLoopback(Handle& listener, int& port, std::string& error) {
  const Handle fd = ::socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) {
    error = std::string("socket: ") + errnoText(errno);
    return false;
  }
  int yes = 1;
  ::setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof yes);
  const sockaddr_in bindAddress = loopbackAddress(0);
  if (::bind(fd, asSockaddr(bindAddress), sizeof bindAddress) != 0) {
    error = std::string("bind: ") + errnoText(errno);
    ::close(fd);
    return false;
  }
  if (::listen(fd, 8) != 0) {
    error = std::string("listen: ") + errnoText(errno);
    ::close(fd);
    return false;
  }
  sockaddr_in address{};
  socklen_t length = sizeof address;
  if (::getsockname(fd, asSockaddr(address), &length) != 0) {
    error = std::string("getsockname: ") + errnoText(errno);
    ::close(fd);
    return false;
  }
  port = ntohs(address.sin_port);
  listener = fd;
  return true;
}

bool connectLoopback(int port, Handle& client, std::string& error) {
  const Handle fd = ::socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) {
    error = std::string("socket: ") + errnoText(errno);
    return false;
  }
  const sockaddr_in address = loopbackAddress(port);
  if (::connect(fd, asSockaddr(address), sizeof address) != 0) {
    error = std::string("connect: ") + errnoText(errno);
    ::close(fd);
    return false;
  }
  client = fd;
  return true;
}

Handle acceptClient(Handle listener, int timeoutMs, bool& timedOut) {
  timedOut = false;
  for (;;) {
    const Readiness readiness = waitReadable(listener, timeoutMs);
    timedOut = readiness == Readiness::TimedOut;
    if (readiness != Readiness::Ready) return kInvalidHandle;
    const Handle fd = ::accept(listener, nullptr, nullptr);
    if (fd >= 0) {
      tuneAccepted(fd);
      return fd;
    }
    if (errno != EINTR && errno != ECONNABORTED) return kInvalidHandle;
  }
}

long receiveSome(Handle socket, char* buffer, size_t capacity) {
  for (;;) {
    const ssize_t n = ::recv(socket, buffer, capacity, 0);
    if (n < 0 && errno == EINTR) continue;
    return static_cast<long>(n);
  }
}

bool sendAll(Handle socket, const char* data, size_t size) {
#ifdef MSG_NOSIGNAL
  const int flags = MSG_NOSIGNAL;
#else
  const int flags = 0;
#endif
  while (size > 0) {
    const ssize_t n = ::send(socket, data, size, flags);
    if (n < 0) {
      if (errno == EINTR) continue;
      return false;
    }
    data += n;
    size -= static_cast<size_t>(n);
  }
  return true;
}

bool peerClosed(Handle socket) {
  pollfd waiting{};
  waiting.fd = socket;
  waiting.events = POLLIN;
  waiting.revents = 0;
  int ready = ::poll(&waiting, 1, 0);
  while (ready < 0 && errno == EINTR) ready = ::poll(&waiting, 1, 0);
  if (ready < 0) return true;
  if (ready == 0) return false;
  if ((waiting.revents & (POLLHUP | POLLERR | POLLNVAL)) != 0) return true;
  return discardedOrClosed(socket);
}

void setSendTimeout(Handle socket, int timeoutMs) {
  timeval limit{};
  limit.tv_sec = timeoutMs / 1000;
  limit.tv_usec = static_cast<suseconds_t>(timeoutMs % 1000) * 1000;
  ::setsockopt(socket, SOL_SOCKET, SO_SNDTIMEO, &limit, sizeof limit);
}

void shutdownRead(Handle socket) { ::shutdown(socket, SHUT_RD); }
void shutdownBoth(Handle socket) { ::shutdown(socket, SHUT_RDWR); }
void closeHandle(Handle socket) { ::close(socket); }

}
