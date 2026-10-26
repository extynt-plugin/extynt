// The text of the plugin's log file, as pure functions so they are tested off After Effects. Pure core.
#pragma once

#include <cstdint>
#include <string>

namespace extynt {

// "2026-10-05T13:55:02.512Z" for a Unix time in milliseconds (UTC; a time before 1970 reads as 1970).
std::string formatLogTime(int64_t unixMs);

// The file the previous run's log is kept in: "<dir>/native-core.log" -> "<dir>/native-core.1.log".
std::string rotatedLogPath(const std::string& path);

}
