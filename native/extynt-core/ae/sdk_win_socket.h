// Winsock's bind as an exported function pointer of ws2_32.
#pragma once

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>

namespace extynt::ae::sdkwin {

// Winsock's bind.
using BindFunction = int(WSAAPI*)(SOCKET, const sockaddr*, int);

// ws2_32's exported bind, or null when `ws2` does not export it.
BindFunction exportedBind(HMODULE ws2);

}
