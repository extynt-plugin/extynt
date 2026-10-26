// The two binary formats an effect plug-in's property list lives in, read defensively: the PiPL resource itself (a flat
// property list, big-endian from Rez on macOS, written by PiPLtool on Windows) and the classic resource-fork container
// a macOS bundle's .rsrc file uses. Every read is bounds-checked and capped; a malformed input yields nothing.
// PF_OutFlag_I_DO_DIALOG only says an effect HAS an Options dialog; whether adding it opens one is decided at run time.
#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace extynt {

constexpr uint32_t fourCC(char a, char b, char c, char d) {
  return (static_cast<uint32_t>(static_cast<unsigned char>(a)) << 24) |
         (static_cast<uint32_t>(static_cast<unsigned char>(b)) << 16) |
         (static_cast<uint32_t>(static_cast<unsigned char>(c)) << 8) |
         static_cast<uint32_t>(static_cast<unsigned char>(d));
}

// PF_OutFlag_I_DO_DIALOG, AE_Effect.h
constexpr uint32_t kOutFlagIDoDialog = 1U << 5;
constexpr size_t kMaxPiplBytes = size_t{64} * 1024;
constexpr size_t kMaxResourceForkBytes = size_t{16} * 1024 * 1024;

struct PiplEffect {
  // 'eMNA'
  std::string matchName;
  // 'eGLO' (AE_Effect_Global_OutFlags)
  uint32_t globalOutFlags = 0;
};

// An effect's PiPL: needs a printable-ASCII match name and the global out flags. Nothing for another kind of plug-in or
// for bytes that are not a property list.
std::optional<PiplEffect> parsePipl(std::string_view bytes);

[[nodiscard]] constexpr bool flagsHaveOptionsDialog(uint32_t globalOutFlags) {
  return (globalOutFlags & kOutFlagIDoDialog) != 0;
}

// The data of every resource of `type` in a classic resource-fork image (at most kMaxResourcesPerType, each at most
// kMaxPiplBytes). The views point into `fork`.
std::vector<std::string_view> forkResources(std::string_view fork, uint32_t type);

}
