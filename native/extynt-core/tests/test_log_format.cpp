// The log file's timestamp and the name the previous run's log is rotated to.
#include <string>

#include "log_format.h"
#include "testing.h"

using namespace extynt;

namespace {

TEST(log_time_is_utc_iso_with_milliseconds) {
  CHECK_EQ(formatLogTime(0), std::string("1970-01-01T00:00:00.000Z"));
  CHECK_EQ(formatLogTime(-5), std::string("1970-01-01T00:00:00.000Z"));
  CHECK_EQ(formatLogTime(1759672502512), std::string("2025-10-05T13:55:02.512Z"));
  CHECK_EQ(formatLogTime(1791208502007), std::string("2026-10-05T13:55:02.007Z"));
  CHECK_EQ(formatLogTime(951782400000), std::string("2000-02-29T00:00:00.000Z"));
  CHECK_EQ(formatLogTime(1709251199999), std::string("2024-02-29T23:59:59.999Z"));
  CHECK_EQ(formatLogTime(4107542400000), std::string("2100-03-01T00:00:00.000Z"));
}

TEST(the_previous_log_rotates_to_a_numbered_sibling) {
  CHECK_EQ(rotatedLogPath("/a/b/native-core.log"), std::string("/a/b/native-core.1.log"));
  CHECK_EQ(rotatedLogPath("/a.d/native-core"), std::string("/a.d/native-core.1"));
  CHECK_EQ(rotatedLogPath("/a/.hidden"), std::string("/a/.hidden.1"));
  CHECK_EQ(rotatedLogPath("plain.txt"), std::string("plain.1.txt"));
}

}
