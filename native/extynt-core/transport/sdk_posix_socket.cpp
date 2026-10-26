// The sockaddr views of sdk_posix_socket.h.
#include "sdk_posix_socket.h"

#include <netinet/in.h>
#include <sys/socket.h>

namespace extynt::net {

const sockaddr* asSockaddr(const sockaddr_in& address) { return reinterpret_cast<const sockaddr*>(&address); }

sockaddr* asSockaddr(sockaddr_in& address) { return reinterpret_cast<sockaddr*>(&address); }

}
