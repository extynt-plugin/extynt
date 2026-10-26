// Synthetic PiPL and resource-fork bytes for the parser and plug-in file tests.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "pipl.h"

namespace pipltest {

using namespace extynt;

inline void put32(std::string& out, uint32_t value, bool little) {
  for (int i = 0; i < 4; ++i) {
    const int shift = little ? 8 * i : 8 * (3 - i);
    out.push_back(static_cast<char>((value >> shift) & 0xFFU));
  }
}

inline void put16be(std::string& out, uint32_t value) {
  out.push_back(static_cast<char>((value >> 8) & 0xFFU));
  out.push_back(static_cast<char>(value & 0xFFU));
}

inline void property(std::string& out, uint32_t key, const std::string& data, bool little) {
  put32(out, fourCC('8', 'B', 'I', 'M'), little);
  put32(out, key, little);
  put32(out, 0, little);
  put32(out, static_cast<uint32_t>(data.size()), little);
  out += data;
  while (out.size() % 4 != 0) out.push_back('\0');
}

inline std::string pascal(const std::string& text) { return std::string(1, static_cast<char>(text.size())) + text; }

inline std::string flagsData(uint32_t flags, bool little) {
  std::string data;
  put32(data, flags, little);
  return data;
}

inline std::string makePipl(const std::string& matchName, uint32_t flags, bool little, uint32_t extraProperties = 0) {
  std::string body;
  property(body, fourCC('k', 'i', 'n', 'd'), flagsData(fourCC('e', 'F', 'K', 'T'), little), little);
  property(body, fourCC('e', 'M', 'N', 'A'), pascal(matchName), little);
  property(body, fourCC('e', 'G', 'L', 'O'), flagsData(flags, little), little);
  std::string out = little ? std::string("\x01\x00", 2) : std::string();
  put32(out, 0, little);
  put32(out, 3 + extraProperties, little);
  return out + body;
}

struct ForkType {
  uint32_t type = 0;
  std::vector<std::string> resources;
};

// A classic resource fork: header, the data section, then the map with its type list and reference list.
inline std::string makeFork(const std::vector<ForkType>& types) {
  std::string data;
  std::vector<std::vector<uint32_t>> offsets;
  for (const ForkType& type : types) {
    offsets.emplace_back();
    for (const std::string& resource : type.resources) {
      offsets.back().push_back(static_cast<uint32_t>(data.size()));
      put32(data, static_cast<uint32_t>(resource.size()), false);
      data += resource;
    }
  }
  std::string typeList;
  put16be(typeList, static_cast<uint32_t>(types.size() - 1));
  size_t refsAt = 2 + (types.size() * 8);
  for (const ForkType& type : types) {
    put32(typeList, type.type, false);
    put16be(typeList, static_cast<uint32_t>(type.resources.size() - 1));
    put16be(typeList, static_cast<uint32_t>(refsAt));
    refsAt += type.resources.size() * size_t{12};
  }
  for (size_t ti = 0; ti < types.size(); ++ti) {
    for (size_t ri = 0; ri < types[ti].resources.size(); ++ri) {
      put16be(typeList, static_cast<uint32_t>(ri));
      put16be(typeList, 0xFFFFU);
      put32(typeList, offsets[ti][ri], false);
      put32(typeList, 0, false);
    }
  }
  std::string map(24, '\0');
  put16be(map, 28);
  put16be(map, 28 + static_cast<uint32_t>(typeList.size()));
  map += typeList;
  std::string fork;
  put32(fork, 16, false);
  put32(fork, static_cast<uint32_t>(16 + data.size()), false);
  put32(fork, static_cast<uint32_t>(data.size()), false);
  put32(fork, static_cast<uint32_t>(map.size()), false);
  return fork + data + map;
}

}
