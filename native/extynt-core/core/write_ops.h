// The write-path prototype (apply_test, undo_test): fixed ExtendScript templates that
// AEGP_ExecuteScript runs on the main thread, each followed by a native read that verifies the result in the
// same idle turn. Pure core: it only talks to a HostReader.
//
// Safety rule: no text from a request ever becomes script text. Every number is validated and rendered here
// (ids as digits, opacity as a finite number from 0 to 100).
#pragma once

#include <string>

#include "host_reader.h"
#include "request.h"

namespace extynt {

// The property the prototype writes and reads back.
// "ADBE Transform Group/ADBE Opacity"
extern const char* const kOpacityPath;

// Scripts. Each throws HostFailure("BAD_REQUEST") for an argument that is not a plain integer id or a number in range.
std::string buildApplyOpacityScript(const Id& compId, const Id& layerId, double opacity);
std::string buildUndoScript();
// The text of `text` as the inside of a double-quoted JavaScript string.
std::string escapeJsString(const std::string& text);

// Each returns the JSON text of the response "result" member.
std::string runApplyTest(HostReader& host, const Request& request);
std::string runUndoTest(HostReader& host, const Request& request);

}
