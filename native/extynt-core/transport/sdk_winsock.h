// The conversions Winsock's calls need: a sockaddr_in or sockaddr_in6 viewed as the sockaddr they take, a bind call's
// sockaddr read back as one, and socket options passed as the bytes setsockopt wants. Windows only.
#pragma once

#include <winsock2.h>
#include <ws2tcpip.h>

#include <optional>

namespace extynt::net {

// `address` as the sockaddr a call reads; it must outlive the call.
const sockaddr* asSockaddr(const sockaddr_in& address);
const sockaddr* asSockaddr(const sockaddr_in6& address);

// `address` as the sockaddr a call fills in.
sockaddr* asSockaddr(sockaddr_in& address);

// The IPv4 or IPv6 address a sockaddr of `length` bytes holds; nothing when it is another family or too short.
std::optional<sockaddr_in> asSockaddrIn(const sockaddr& name, int length);
std::optional<sockaddr_in6> asSockaddrIn6(const sockaddr& name, int length);

// Sets a socket option whose value is a flag that is on.
void enableSocketFlag(SOCKET socket, int level, int option);

// Sets the send timeout of `socket`, in milliseconds.
void setSendTimeoutMs(SOCKET socket, DWORD milliseconds);

}
