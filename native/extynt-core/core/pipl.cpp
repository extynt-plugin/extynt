// Reads the PiPL resource and the classic resource-fork container, bounds-checked and capped, and finds the effect
// flags.

#include "pipl.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace extynt {

namespace {

constexpr uint32_t kVendorAdobe = fourCC('8', 'B', 'I', 'M');
constexpr uint32_t kKeyMatchName = fourCC('e', 'M', 'N', 'A');
constexpr uint32_t kKeyGlobalOutFlags = fourCC('e', 'G', 'L', 'O');
constexpr size_t kPiplHeaderBytes = 8;
constexpr size_t kWindowsPrefixBytes = 2;
constexpr size_t kPropertyHeaderBytes = 16;
constexpr uint32_t kMaxProperties = 1024;
constexpr size_t kMaxMatchNameBytes = 255;
constexpr size_t kMaxResourcesPerType = 4096;

struct Reader {
  std::string_view bytes;
  bool littleEndian = false;

  [[nodiscard]] bool has(size_t offset, size_t count) const {
    return offset <= bytes.size() && count <= bytes.size() - offset;
  }
  [[nodiscard]] uint8_t byteAt(size_t offset) const { return static_cast<uint8_t>(bytes[offset]); }
  [[nodiscard]] uint32_t u32(size_t offset) const {
    uint32_t value = 0;
    for (size_t i = 0; i < 4; ++i) {
      const uint32_t part = byteAt(offset + (littleEndian ? 3 - i : i));
      value = (value << 8) | part;
    }
    return value;
  }
};

struct Layout {
  bool littleEndian = false;
  size_t header = 0;
};

std::optional<Layout> detectLayout(std::string_view bytes) {
  for (const size_t header : {size_t{0}, kWindowsPrefixBytes}) {
    const Reader big{bytes, false};
    if (!big.has(header, kPiplHeaderBytes + 4)) return std::nullopt;
    if (big.u32(header + kPiplHeaderBytes) == kVendorAdobe) return Layout{false, header};
    if (Reader{bytes, true}.u32(header + kPiplHeaderBytes) == kVendorAdobe) return Layout{true, header};
  }
  return std::nullopt;
}

bool printableMatchName(std::string_view name) {
  if (name.empty() || name.size() > kMaxMatchNameBytes) return false;
  return std::all_of(name.begin(), name.end(), [](char c) { return c >= 0x20 && c <= 0x7e; });
}

std::optional<std::string> pascalString(const Reader& in, size_t offset, size_t length) {
  if (length < 1) return std::nullopt;
  const size_t size = in.byteAt(offset);
  if (size + 1 > length) return std::nullopt;
  return std::string(in.bytes.substr(offset + 1, size));
}

struct Collected {
  std::optional<std::string> matchName;
  std::optional<uint32_t> flags;
};

struct PropertyRecord {
  uint32_t key;
  size_t dataOffset;
  size_t length;
};

void takeProperty(const Reader& in, const PropertyRecord& property, Collected& out) {
  if (property.key == kKeyMatchName) out.matchName = pascalString(in, property.dataOffset, property.length);
  else if (property.key == kKeyGlobalOutFlags && property.length >= 4) out.flags = in.u32(property.dataOffset);
}

Collected collectProperties(const Reader& in, size_t start, uint32_t count) {
  Collected found;
  size_t offset = start;
  for (uint32_t i = 0; i < count; ++i) {
    if (!in.has(offset, kPropertyHeaderBytes)) break;
    const uint32_t length = in.u32(offset + 12);
    const size_t dataOffset = offset + kPropertyHeaderBytes;
    if (!in.has(dataOffset, length)) break;
    takeProperty(in, {in.u32(offset + 4), dataOffset, length}, found);
    offset = dataOffset + ((static_cast<size_t>(length) + 3U) & ~static_cast<size_t>(3U));
  }
  return found;
}

}

std::optional<PiplEffect> parsePipl(std::string_view bytes) {
  if (bytes.size() > kMaxPiplBytes) return std::nullopt;
  const std::optional<Layout> layout = detectLayout(bytes);
  if (!layout) return std::nullopt;
  const Reader in{bytes, layout->littleEndian};
  const uint32_t count = in.u32(layout->header + 4);
  if (count == 0 || count > kMaxProperties) return std::nullopt;
  const Collected found = collectProperties(in, layout->header + kPiplHeaderBytes, count);
  if (!found.matchName || !found.flags || !printableMatchName(*found.matchName)) return std::nullopt;
  return PiplEffect{*found.matchName, *found.flags};
}

namespace {

constexpr size_t kForkHeaderBytes = 16;
constexpr size_t kMapTypeListField = 24;
constexpr size_t kTypeEntryBytes = 8;
constexpr size_t kReferenceBytes = 12;

uint32_t be32(const Reader& in, size_t offset) { return in.u32(offset); }
uint32_t be16(const Reader& in, size_t offset) {
  return (static_cast<uint32_t>(in.byteAt(offset)) << 8) | in.byteAt(offset + 1);
}

std::optional<std::string_view> referencedData(const Reader& in, size_t dataStart, size_t reference) {
  if (!in.has(reference, kReferenceBytes)) return std::nullopt;
  const size_t at = dataStart + (be32(in, reference + 4) & 0x00FFFFFFU);
  if (!in.has(at, 4)) return std::nullopt;
  const size_t length = be32(in, at);
  if (length > kMaxPiplBytes || !in.has(at + 4, length)) return std::nullopt;
  return in.bytes.substr(at + 4, length);
}

struct TypeEntry {
  size_t dataStart;
  size_t references;
  size_t count;
};

void appendResources(const Reader& in, const TypeEntry& type, std::vector<std::string_view>& out) {
  for (size_t index = 0; index < type.count; ++index) {
    const std::optional<std::string_view> data =
        referencedData(in, type.dataStart, type.references + (index * kReferenceBytes));
    if (data) out.push_back(*data);
  }
}

}

std::vector<std::string_view> forkResources(std::string_view fork, uint32_t type) {
  std::vector<std::string_view> out;
  const Reader in{fork, false};
  if (fork.size() > kMaxResourceForkBytes || !in.has(0, kForkHeaderBytes)) return out;
  const size_t dataStart = be32(in, 0);
  const size_t mapStart = be32(in, 4);
  if (!in.has(mapStart, kMapTypeListField + 2)) return out;
  const size_t typeList = mapStart + be16(in, mapStart + kMapTypeListField);
  if (!in.has(typeList, 2)) return out;
  const size_t typeCount = static_cast<size_t>(be16(in, typeList)) + 1;
  for (size_t i = 0; i < typeCount; ++i) {
    const size_t entry = typeList + 2 + (i * kTypeEntryBytes);
    if (!in.has(entry, kTypeEntryBytes)) break;
    if (be32(in, entry) != type) continue;
    const size_t count = std::min<size_t>(static_cast<size_t>(be16(in, entry + 4)) + 1, kMaxResourcesPerType);
    appendResources(in, {dataStart, typeList + be16(in, entry + 6), count}, out);
  }
  return out;
}

}
