// Minimal stand-in for libdispatch (Linux syntax check only; NOT the Apple SDK).
#pragma once
#include <stdint.h>
typedef void (^dispatch_block_t)(void);
typedef uint64_t dispatch_time_t;
typedef struct dispatch_queue_s* dispatch_queue_t;
#define DISPATCH_TIME_NOW (0ull)
#define NSEC_PER_SEC 1000000000ull
extern "C" dispatch_time_t dispatch_time(dispatch_time_t when, int64_t delta);
extern "C" dispatch_queue_t dispatch_get_main_queue(void);
extern "C" void dispatch_after(dispatch_time_t when, dispatch_queue_t queue, dispatch_block_t block);
