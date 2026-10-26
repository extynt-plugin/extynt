// Recovering the request id from the start of a line that is refused before it can be parsed (a request over the
// size limit), so the refusal still answers the right call.
#pragma once

#include <cstddef>
#include <string>
#include <string_view>

namespace extynt {

constexpr size_t kRequestIdScanBytes = 256;
constexpr size_t kRequestIdMaxLength = 64;

// The top-level "id" of a request object whose first bytes are `head` (a JSON string without escapes, or a
// non-negative integer), or "" when it is absent, nested, escaped, too long or not inside `head`.
std::string recoverRequestId(std::string_view head);

}
