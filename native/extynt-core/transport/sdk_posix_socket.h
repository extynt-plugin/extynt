// The one place a sockaddr_in is viewed as the sockaddr that the POSIX socket calls take. POSIX only.
#pragma once

#include <netinet/in.h>
#include <sys/socket.h>

namespace extynt::net {

// `address` as the sockaddr a call reads; it must outlive the call.
const sockaddr* asSockaddr(const sockaddr_in& address);

// `address` as the sockaddr a call fills in.
sockaddr* asSockaddr(sockaddr_in& address);

}
