// Thin socket abstraction. POSIX (macOS, and Linux for the unit tests) lives in net_posix.cpp, Windows (Winsock) in
// net_win.cpp; CMake picks one.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace extynt::net {

#ifdef _WIN32
// A SOCKET is pointer-sized; the platform file converts at the Winsock boundary.
using Handle = std::intptr_t;
#else
using Handle = int;
#endif
constexpr Handle kInvalidHandle = -1;

// Binds 127.0.0.1 on a kernel-chosen port and listens. Returns false with `error` set on failure.
bool listenLoopback(Handle& listener, int& port, std::string& error);
// Connects to 127.0.0.1:`port` (a client for the tests and tools). Returns false with `error` set on failure.
bool connectLoopback(int port, Handle& client, std::string& error);
// Waits up to `timeoutMs` for a client. Returns kInvalidHandle with `timedOut` true when nothing arrived
// (the caller re-checks its stop flag and calls again), or with `timedOut` false when the listener failed.
// Polling rather than blocking: macOS does not reliably wake a blocked accept() when another thread closes the socket.
Handle acceptClient(Handle listener, int timeoutMs, bool& timedOut);
// Blocks. Returns bytes read, 0 on orderly close, negative on error (or when shut down).
long receiveSome(Handle socket, char* buffer, size_t capacity);
bool sendAll(Handle socket, const char* data, size_t size);
// True when the peer has hung up (an orderly close, a reset or an error). Bytes the peer sent are read and discarded,
// so a watch connection that only writes never lets its receive buffer fill.
bool peerClosed(Handle socket);
// Bounds how long a send may block; a send that times out fails like any other, so a slow reader cannot hang a caller.
void setSendTimeout(Handle socket, int timeoutMs);
// Wakes a thread blocked in receiveSome on a connected socket; sends still work afterwards.
void shutdownRead(Handle socket);
// Ends both directions of a connected socket.
void shutdownBoth(Handle socket);
void closeHandle(Handle socket);

}
