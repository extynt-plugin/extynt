// The exported-function lookup of sdk_win_socket.h.
#include "sdk_win_socket.h"

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>

namespace extynt::ae::sdkwin {

BindFunction exportedBind(HMODULE ws2) {
  return reinterpret_cast<BindFunction>(reinterpret_cast<void (*)()>(GetProcAddress(ws2, "bind")));
}

}
