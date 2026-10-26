// scripts/lib/native-metrics.ts: lizard report parsing and the shared limits applied to C++ and Objective-C++.
import assert from "node:assert/strict";
import test from "node:test";
import { lizardFailures, parseLizard } from "../scripts/lib/native-metrics.ts";

const REPORT = `================================================
  NLOC    CCN   token  PARAM  length  location
------------------------------------------------
       6      1     58      4       6 extynt::writeEnvelopeHead@12-17@core/executor.cpp
      41      3    125      1      90 extynt::Big::run@34-124@core/big.cpp
      20      9    125      5      20 extynt::Knot::tie@5-25@core/big.cpp
      10      2     90      4      10 -[Panel keyDown:]@40-50@ae/panel.mm
1 file analyzed.
==============================================================
NLOC    Avg.NLOC  AvgCCN  Avg.token   function_cnt    file
--------------------------------------------------------------
    401      20.0     2.0     90.0         3     core/big.cpp
     40      13.0     2.0     90.0         1     core/small.cpp
Total nloc   Avg.NLOC  AvgCCN  Avg.token  Fun Cnt  Warning cnt   Fun Rt   nloc Rt
------------------------------------------------------------------------------------------
        541      20.0     2.0     90.0        4            0      0.00    0.00
`;

test("parseLizard reads function rows and per-file NLOC rows", () => {
  const parsed = parseLizard(REPORT);
  assert.equal(parsed.functions.length, 4);
  assert.deepEqual(parsed.functions[1], { nloc: 41, ccn: 3, params: 1, name: "extynt::Big::run", line: 34, file: "core/big.cpp" });
  assert.deepEqual(parsed.files, [{ nloc: 401, file: "core/big.cpp" }, { nloc: 40, file: "core/small.cpp" }]);
});

test("limits: function 40 NLOC, complexity 8, 4 parameters, file 400 NLOC", () => {
  const failures = lizardFailures(parseLizard(REPORT));
  assert.deepEqual(failures, [
    "core/big.cpp:34 extynt::Big::run has 41 NLOC > 40",
    "core/big.cpp:5 extynt::Knot::tie complexity 9 > 8",
    "core/big.cpp:5 extynt::Knot::tie has 5 parameters; pass one struct",
    "core/big.cpp: 401 NLOC > 400",
  ]);
});

test("exactly at the limits passes", () => {
  const report = "      40      8     90      4      40 f@1-40@a.cpp\n    400      9.0     2.0     90.0         1     a.cpp\n";
  assert.deepEqual(lizardFailures(parseLizard(report)), []);
});

test("only the entry point inside a real sdk_ wrapper file may exceed the parameter limit", () => {
  const entry = (file: string) => ({ functions: [{ nloc: 5, ccn: 1, params: 9, name: "EntryPointFunc", line: 1, file }], files: [] });
  assert.deepEqual(lizardFailures(entry("native/extynt-core/ae/sdk_entry.cpp")), []);
  assert.equal(lizardFailures(entry("native/extynt-core/core/sdk_entry.cpp")).length, 1);
  assert.equal(lizardFailures(entry("native/extynt-core/tests/sdk_entry.cpp")).length, 1);
});
