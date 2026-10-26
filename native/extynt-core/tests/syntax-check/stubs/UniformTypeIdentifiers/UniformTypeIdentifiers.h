// Minimal stand-in for UniformTypeIdentifiers.h (Linux syntax check only; NOT the Apple SDK).
#pragma once
#include <Cocoa/Cocoa.h>
@interface UTType : NSObject
+ (UTType*)typeWithFilenameExtension:(NSString*)extension;
@end
extern UTType* const UTTypePNG;
extern UTType* const UTTypeJPEG;
extern UTType* const UTTypeWebP;
