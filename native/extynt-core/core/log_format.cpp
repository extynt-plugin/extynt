// Formats one log line: UTC timestamp from epoch milliseconds, level and message, without locale or printf.

#include "log_format.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>

namespace extynt {

namespace {

constexpr int64_t kMsPerSecond = 1000;
constexpr int64_t kSecondsPerDay = 86400;

struct Civil {
  int64_t year = 1970;
  int64_t month = 1;
  int64_t day = 1;
};

bool isLeapYear(int64_t year) { return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0; }

int64_t daysInYear(int64_t year) { return isLeapYear(year) ? 366 : 365; }

int64_t daysInMonth(int64_t year, int64_t month) {
  constexpr std::array<int64_t, 12> lengths = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  const auto index = static_cast<size_t>(month - 1);
  return month == 2 && isLeapYear(year) ? 29 : lengths.at(index);
}

Civil civilFromDays(int64_t days) {
  Civil out;
  while (days >= daysInYear(out.year)) {
    days -= daysInYear(out.year);
    ++out.year;
  }
  while (days >= daysInMonth(out.year, out.month)) {
    days -= daysInMonth(out.year, out.month);
    ++out.month;
  }
  out.day = days + 1;
  return out;
}

std::string padded(int64_t value, size_t width) {
  const std::string digits = std::to_string(value);
  return std::string(digits.size() < width ? width - digits.size() : 0, '0') + digits;
}

}

std::string formatLogTime(int64_t unixMs) {
  const int64_t ms = unixMs < 0 ? 0 : unixMs;
  const int64_t seconds = ms / kMsPerSecond;
  const Civil date = civilFromDays(seconds / kSecondsPerDay);
  const int64_t secondOfDay = seconds % kSecondsPerDay;
  return padded(date.year, 4) + "-" + padded(date.month, 2) + "-" + padded(date.day, 2) + "T" +
         padded(secondOfDay / 3600, 2) + ":" + padded((secondOfDay % 3600) / 60, 2) + ":" +
         padded(secondOfDay % 60, 2) + "." + padded(ms % kMsPerSecond, 3) + "Z";
}

std::string rotatedLogPath(const std::string& path) {
  const size_t slash = path.find_last_of('/');
  const size_t dot = path.find_last_of('.');
  const bool hasExtension = dot != std::string::npos && (slash == std::string::npos || dot > slash + 1);
  return hasExtension ? path.substr(0, dot) + ".1" + path.substr(dot) : path + ".1";
}

}
