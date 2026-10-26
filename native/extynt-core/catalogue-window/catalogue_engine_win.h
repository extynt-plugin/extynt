// Windows only: the catalogue window's conversation with the sidecar. The session (port and token) is read from
// %LOCALAPPDATA%\extynt\session.json once the install has started the sidecar; POST starts the effect catalogue engine
// and GET follows it, both on /v1/catalogue/engine of the loopback sidecar. Answers made on a worker thread wait in an
// AnswerQueue until the window thread takes them.
#pragma once

#include <mutex>
#include <optional>
#include <vector>

#include "catalogue_status.h"
#include "session_port.h"

namespace extynt::catalogue {

std::optional<SessionEndpoint> readSession();
// True when both are known and name a different sidecar instance (it restarted: new port or token).
bool sessionMoved(const std::optional<SessionEndpoint>& known, const std::optional<SessionEndpoint>& latest);

std::optional<Status> requestEngine(const SessionEndpoint& endpoint, bool post);

class AnswerQueue {
 public:
  void push(std::optional<Status> answer);
  std::vector<std::optional<Status>> drain();

 private:
  std::mutex lock_;
  std::vector<std::optional<Status>> answers_;
};

}
