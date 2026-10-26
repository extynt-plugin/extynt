// Blocking client helpers for the tests that talk to a real Server over loopback.
#pragma once

#include <string>

#include "json_probe.h"
#include "net.h"
#include "testing.h"

namespace testing {

inline extynt::net::Handle connectTo(int port) {
  extynt::net::Handle fd = extynt::net::kInvalidHandle;
  std::string error;
  if (!extynt::net::connectLoopback(port, fd, error)) throw Failure{"connect failed: " + error};
  return fd;
}

// One line (without its newline), or "" when the peer closed first.
inline std::string readLine(extynt::net::Handle fd) {
  std::string line;
  char c = 0;
  while (extynt::net::receiveSome(fd, &c, 1) == 1) {
    if (c == '\n') return line;
    line += c;
  }
  return "";
}

inline void sendLine(extynt::net::Handle fd, const std::string& line) {
  const std::string out = line + "\n";
  if (!extynt::net::sendAll(fd, out.data(), out.size())) throw Failure{"send failed"};
}

inline std::string roundTrip(extynt::net::Handle fd, const std::string& line) {
  sendLine(fd, line);
  std::string reply = readLine(fd);
  if (reply.empty()) throw Failure{"connection closed before a full reply line"};
  return reply;
}

inline extynt::JsonValue parsedReply(const std::string& text) {
  extynt::JsonValue value;
  std::string error;
  if (!extynt::parseJson(text, value, error)) throw Failure{"bad reply: " + text};
  return value;
}

inline const extynt::JsonValue& member(const extynt::JsonValue& value, const char* key) {
  const extynt::JsonValue* found = value.find(key);
  if (!found) throw Failure{std::string("missing key ") + key};
  return *found;
}

}
