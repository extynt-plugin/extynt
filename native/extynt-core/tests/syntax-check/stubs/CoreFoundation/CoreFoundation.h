// Minimal stand-in for CoreFoundation.h: only what native/extynt-core/ae uses, with the real signatures.
// For a Linux syntax check; it is NOT the Apple SDK.
#pragma once
#include <stddef.h>
#include <stdint.h>
typedef const void* CFTypeRef;
typedef const struct __CFString* CFStringRef;
typedef struct __CFBundle* CFBundleRef;
typedef unsigned long CFTypeID;
typedef signed long CFIndex;
typedef uint32_t CFStringEncoding;
typedef unsigned char Boolean;
#define kCFStringEncodingUTF8 ((CFStringEncoding)0x08000100)
#define CFSTR(literal) (static_cast<CFStringRef>(static_cast<const void*>(literal)))
extern "C" CFBundleRef CFBundleGetMainBundle(void);
extern "C" CFTypeRef CFBundleGetValueForInfoDictionaryKey(CFBundleRef bundle, CFStringRef key);
extern "C" CFTypeID CFGetTypeID(CFTypeRef cf);
extern "C" CFTypeID CFStringGetTypeID(void);
extern "C" Boolean CFStringGetCString(CFStringRef theString, char* buffer, CFIndex bufferSize, CFStringEncoding encoding);
typedef const struct __CFURL* CFURLRef;
typedef const struct __CFArray* CFArrayRef;
typedef const struct __CFDictionary* CFDictionaryRef;
typedef const struct __CFNumber* CFNumberRef;
typedef CFIndex CFNumberType;
#define kCFNumberIntType ((CFNumberType)9)
typedef CFIndex CFURLPathStyle;
#define kCFURLPOSIXPathStyle ((CFURLPathStyle)0)
extern "C" CFURLRef CFBundleCopyBundleURL(CFBundleRef bundle);
extern "C" CFStringRef CFURLCopyFileSystemPath(CFURLRef anURL, CFURLPathStyle pathStyle);
extern "C" void CFRelease(CFTypeRef cf);
extern "C" CFIndex CFArrayGetCount(CFArrayRef theArray);
extern "C" const void* CFArrayGetValueAtIndex(CFArrayRef theArray, CFIndex idx);
extern "C" const void* CFDictionaryGetValue(CFDictionaryRef theDict, const void* key);
extern "C" CFTypeID CFDictionaryGetTypeID(void);
extern "C" CFTypeID CFNumberGetTypeID(void);
extern "C" Boolean CFNumberGetValue(CFNumberRef number, CFNumberType theType, void* valuePtr);
typedef const struct __CFAllocator* CFAllocatorRef;
extern "C" const CFAllocatorRef kCFAllocatorDefault;
extern "C" CFTypeRef CFRetain(CFTypeRef cf);
extern "C" CFStringRef CFStringCreateWithCString(CFAllocatorRef alloc, const char* cStr, CFStringEncoding encoding);
extern "C" CFURLRef CFURLCreateWithFileSystemPath(CFAllocatorRef allocator, CFStringRef filePath,
                                                  CFURLPathStyle pathStyle, Boolean isDirectory);
extern "C" CFBundleRef CFBundleCreate(CFAllocatorRef allocator, CFURLRef bundleURL);
