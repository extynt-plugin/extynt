// Thread-safe text for an errno value (std::strerror shares a static buffer).
#pragma once

#include <string>
#include <system_error>

namespace extynt {

inline std::string errnoText(int code) { return std::error_code(code, std::generic_category()).message(); }

}
