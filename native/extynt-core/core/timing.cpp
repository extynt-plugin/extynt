// Writes the per-response timing report as JSON.

#include "timing.h"
#include "json_writer.h"
#include <cstdint>

namespace extynt {

void Timing::write(JsonWriter& writer) const {
  writer.beginObject();
  writer.fieldNum("queuedMs", queuedMs);
  writer.fieldNum("walkMs", walkMs);
  writer.fieldNum("hashMs", hashMs);
  writer.fieldNum("contentMs", contentMs);
  writer.fieldNum("serializeMs", serializeMs);
  writer.fieldNum("totalMainThreadMs", totalMainThreadMs);
  writer.fieldInt("bytes", static_cast<int64_t>(bytes));
  writer.fieldInt("getterCalls", static_cast<int64_t>(getterCalls));
  writer.field("dispatchedBy", dispatchedBy);
  writer.endObject();
}

}
