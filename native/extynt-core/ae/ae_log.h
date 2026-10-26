// The plugin's own log file (native-core.log next to the discovery file). Any thread.
#pragma once

#include <string>

namespace extynt::ae {

// Sets the file: the previous one is renamed to native-core.1.log (replacing an older rotation) and a new one is
// started. Each line carries a UTC timestamp with milliseconds and never a token. Until this is called, logLine does
// nothing.
void startLogFile(const std::string& path);

// The directory the discovery file, the log and panel-url.txt live in, without a trailing slash ("" if unknown).
std::string stateDirectory();

void logLine(const std::string& text);

// For a catch (...) at a host boundary that has nothing else to do with the exception: notes in the log that one was
// dropped, `where` saying at which boundary. Never throws, from any thread.
void logDroppedException(const char* where) noexcept;

}
