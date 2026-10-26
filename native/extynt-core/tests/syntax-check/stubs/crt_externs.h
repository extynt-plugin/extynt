// Minimal stand-in for <crt_externs.h>: the process's own argc/argv, with the real signatures. NOT the Apple SDK.
#pragma once
extern "C" int* _NSGetArgc(void);
extern "C" char*** _NSGetArgv(void);
