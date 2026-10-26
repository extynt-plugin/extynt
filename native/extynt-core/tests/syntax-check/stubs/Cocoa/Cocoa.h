// Minimal stand-in for Cocoa.h: only what native/extynt-core/ae/ae_panel_mac.mm uses, with the real signatures.
// For a Linux syntax check (clang -fsyntax-only -x objective-c++ -fobjc-arc); it is NOT the Apple SDK.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <CoreFoundation/CoreFoundation.h>
#define nil nullptr
typedef signed char BOOL;
#define YES ((BOOL)1)
#define NO ((BOOL)0)
typedef unsigned long NSUInteger;
typedef long NSInteger;
typedef unsigned short unichar;
typedef double CGFloat;
typedef struct { CGFloat x, y; } NSPoint;
typedef struct { CGFloat width, height; } NSSize;
typedef struct { NSPoint origin; NSSize size; } NSRect;
typedef struct objc_selector* SEL;
extern "C" CFTypeRef CFBridgingRetain(id obj);
extern "C" id CFBridgingRelease(CFTypeRef);

@class NSString, NSError, NSMenu, NSURL, NSArray, NSEvent, NSWindow, NSView, NSResponder, NSCharacterSet;
typedef NSString* NSExceptionName;
typedef struct { unsigned long state; __unsafe_unretained id* itemsPtr; unsigned long* mutationsPtr; unsigned long extra[5]; } NSFastEnumerationState;
@protocol NSObject
@end
@protocol NSFastEnumeration
- (NSUInteger)countByEnumeratingWithState:(NSFastEnumerationState*)state objects:(__unsafe_unretained id*)buffer count:(NSUInteger)len;
@end
@interface NSObject <NSObject>
+ (instancetype)alloc;
+ (instancetype)new;
- (instancetype)init;
- (BOOL)respondsToSelector:(SEL)selector;
- (BOOL)isKindOfClass:(Class)cls;
- (Class)class;
- (void)setValue:(id)value forKey:(NSString*)key;
@end
extern "C" NSString* NSStringFromClass(Class cls);
extern "C" NSString* NSStringFromSelector(SEL selector);
extern "C" SEL NSSelectorFromString(NSString* name);
@interface NSCharacterSet : NSObject
+ (NSCharacterSet*)whitespaceAndNewlineCharacterSet;
@end
typedef NSUInteger NSStringEncoding;
#define NSUTF8StringEncoding ((NSStringEncoding)4)
@interface NSString : NSObject
@property(readonly) NSUInteger length;
@property(readonly) const char* UTF8String;
@property(readonly, copy) NSString* lowercaseString;
+ (instancetype)stringWithUTF8String:(const char*)bytes;
+ (instancetype)stringWithContentsOfFile:(NSString*)path encoding:(NSStringEncoding)enc error:(NSError**)error;
- (unichar)characterAtIndex:(NSUInteger)index;
- (BOOL)isEqualToString:(NSString*)other;
- (NSString*)stringByTrimmingCharactersInSet:(NSCharacterSet*)set;
@end
@interface NSArray<ObjectType> : NSObject <NSFastEnumeration>
@property(readonly) NSUInteger count;
+ (instancetype)arrayWithObjects:(const ObjectType[])objects count:(NSUInteger)cnt;
@end
@interface NSMutableArray<ObjectType> : NSArray<ObjectType>
+ (instancetype)array;
- (void)addObject:(ObjectType)object;
@end
@interface NSHashTable<ObjectType> : NSObject <NSFastEnumeration>
+ (NSHashTable*)weakObjectsHashTable;
@property(readonly) NSUInteger count;
@property(readonly, copy) NSArray* allObjects;
- (void)addObject:(ObjectType)object;
@end
@interface NSNumber : NSObject
+ (NSNumber*)numberWithBool:(BOOL)value;
@end
@interface NSDictionary<KeyType, ObjectType> : NSObject
+ (instancetype)dictionaryWithObjects:(const ObjectType[])objects forKeys:(const id[])keys count:(NSUInteger)count;
@end
@interface NSUserDefaults : NSObject
+ (NSUserDefaults*)standardUserDefaults;
- (void)registerDefaults:(NSDictionary*)registrationDictionary;
@end
@interface NSURL : NSObject
+ (NSURL*)URLWithString:(NSString*)string;
@property(readonly, copy) NSString* absoluteString;
@property(readonly, copy) NSString* host;
@end
@interface NSURLRequest : NSObject
+ (instancetype)requestWithURL:(NSURL*)url;
@property(readonly, copy) NSURL* URL;
@end
@interface NSError : NSObject
@property(readonly, copy) NSString* localizedDescription;
@property(readonly, copy) NSString* domain;
@property(readonly) NSInteger code;
@end
typedef NSString* NSNotificationName;
@interface NSNotification : NSObject
@end
@interface NSOperationQueue : NSObject
+ (NSOperationQueue*)mainQueue;
@end
@interface NSNotificationCenter : NSObject
+ (NSNotificationCenter*)defaultCenter;
- (id<NSObject>)addObserverForName:(NSNotificationName)name object:(id)obj queue:(NSOperationQueue*)queue usingBlock:(void (^)(NSNotification* note))block;
- (void)removeObserver:(id)observer;
@end
extern NSNotificationName NSWindowDidBecomeKeyNotification;
extern NSNotificationName NSApplicationDidBecomeActiveNotification;
extern NSNotificationName NSMenuDidBeginTrackingNotification;
@interface NSWorkspaceOpenConfiguration : NSObject
+ (instancetype)configuration;
@end
@interface NSWorkspace : NSObject
+ (NSWorkspace*)sharedWorkspace;
- (void)openURL:(NSURL*)url configuration:(NSWorkspaceOpenConfiguration*)configuration completionHandler:(void (^)(id app, NSError* error))completionHandler;
@end
@interface NSException : NSObject
@property(readonly, copy) NSString* reason;
@end
@interface NSUndoManager : NSObject
@property(readonly) BOOL canUndo;
@property(readonly) BOOL canRedo;
- (void)undo;
- (void)redo;
@end

typedef NSUInteger NSEventModifierFlags;
#define NSEventModifierFlagShift (1UL << 17)
#define NSEventModifierFlagControl (1UL << 18)
#define NSEventModifierFlagOption (1UL << 19)
#define NSEventModifierFlagCommand (1UL << 20)
#define NSEventModifierFlagFunction (1UL << 23)
#define NSEventModifierFlagDeviceIndependentFlagsMask 0xffff0000UL
typedef NSUInteger NSEventType;
#define NSEventTypeLeftMouseDown ((NSEventType)1)
#define NSEventTypeKeyDown ((NSEventType)10)
#define NSEventTypeKeyUp ((NSEventType)11)
typedef unsigned long long NSEventMask;
#define NSEventMaskLeftMouseDown (1ULL << NSEventTypeLeftMouseDown)
#define NSEventMaskKeyDown (1ULL << NSEventTypeKeyDown)
#define NSEventMaskKeyUp (1ULL << NSEventTypeKeyUp)
@interface NSEvent : NSObject
@property(readonly) NSEventType type;
@property(readonly) double timestamp;
@property(readonly) NSInteger windowNumber;
@property(readonly) NSEventModifierFlags modifierFlags;
@property(readonly) unsigned short keyCode;
@property(readonly, copy) NSString* characters;
@property(readonly, copy) NSString* charactersIgnoringModifiers;
@property(readonly) NSPoint locationInWindow;
@property(readonly, assign) NSWindow* window;
+ (id)addLocalMonitorForEventsMatchingMask:(NSEventMask)mask handler:(NSEvent* (^)(NSEvent*))block;
+ (void)removeMonitor:(id)eventMonitor;
@end

@interface NSMenuItem : NSObject
+ (NSMenuItem*)separatorItem;
@property(readonly, getter=isSeparatorItem) BOOL separatorItem;
@property(copy) NSString* title;
@property(copy) NSString* identifier;
@property SEL action;
@property(strong) NSMenu* submenu;
@property(weak) id target;
@end
@interface NSMenu : NSObject
@property(readonly) NSInteger numberOfItems;
- (NSMenuItem*)itemAtIndex:(NSInteger)index;
- (void)removeItemAtIndex:(NSInteger)index;
- (NSMenuItem*)addItemWithTitle:(NSString*)title action:(SEL)action keyEquivalent:(NSString*)keyEquivalent;
- (void)addItem:(NSMenuItem*)item;
@end

typedef NSString* NSPasteboardType;
@interface NSResponder : NSObject
@property(readonly, strong) NSResponder* nextResponder;
- (void)keyDown:(NSEvent*)event;
- (void)keyUp:(NSEvent*)event;
- (BOOL)performKeyEquivalent:(NSEvent*)event;
- (BOOL)acceptsFirstResponder;
- (id)validRequestorForSendType:(NSPasteboardType)sendType returnType:(NSPasteboardType)returnType;
@end
typedef NSUInteger NSAutoresizingMaskOptions;
#define NSViewWidthSizable 2
#define NSViewHeightSizable 16
@interface NSView : NSResponder
@property(readonly, assign) NSWindow* window;
@property(readonly, assign) NSView* superview;
@property NSRect bounds;
@property(readonly, getter=isHiddenOrHasHiddenAncestor) BOOL hiddenOrHasHiddenAncestor;
@property NSAutoresizingMaskOptions autoresizingMask;
@property(readonly, strong) NSUndoManager* undoManager;
- (instancetype)initWithFrame:(NSRect)frame;
- (BOOL)isDescendantOf:(NSView*)view;
- (NSView*)hitTest:(NSPoint)point;
- (NSPoint)convertPoint:(NSPoint)point fromView:(NSView*)view;
- (void)addSubview:(NSView*)view;
- (void)viewDidMoveToWindow;
- (void)viewDidHide;
- (void)viewDidUnhide;
- (BOOL)acceptsFirstMouse:(NSEvent*)event;
- (void)willOpenMenu:(NSMenu*)menu withEvent:(NSEvent*)event;
@end
typedef NSUInteger NSWindowStyleMask;
typedef NSInteger NSWindowLevel;
@interface NSWindow : NSResponder
@property(readonly, getter=isVisible) BOOL visible;
@property(readonly, getter=isKeyWindow) BOOL keyWindow;
@property(readonly, getter=isMainWindow) BOOL mainWindow;
@property(readonly) BOOL canBecomeKeyWindow;
@property NSWindowLevel level;
@property(readonly) NSWindowStyleMask styleMask;
@property NSSize contentMinSize;
@property(readonly, strong) NSResponder* firstResponder;
@property(copy) NSString* title;
- (void)makeKeyWindow;
- (void)makeKeyAndOrderFront:(id)sender;
- (void)orderOut:(id)sender;
- (BOOL)makeFirstResponder:(NSResponder*)responder;
@end
@interface NSPanel : NSWindow
@property(getter=isFloatingPanel) BOOL floatingPanel;
@property BOOL becomesKeyOnlyIfNeeded;
@end
typedef NSInteger NSApplicationActivationPolicy;
#define NSApplicationActivationPolicyRegular ((NSApplicationActivationPolicy)0)
#define NSApplicationActivationPolicyAccessory ((NSApplicationActivationPolicy)1)
#define NSApplicationActivationPolicyProhibited ((NSApplicationActivationPolicy)2)
@interface NSApplication : NSObject
@property(readonly, getter=isActive) BOOL active;
@property(readonly, copy) NSArray<NSWindow*>* windows;
- (NSApplicationActivationPolicy)activationPolicy;
- (BOOL)setActivationPolicy:(NSApplicationActivationPolicy)activationPolicy;
- (void)deactivate;
- (void)abortModal;
@property(readonly, strong) NSWindow* keyWindow;
@property(readonly, strong) NSWindow* mainWindow;
@property(readonly, strong) NSWindow* modalWindow;
- (BOOL)sendAction:(SEL)action to:(id)target from:(id)sender;
@end
extern NSApplication* NSApp;
@class UTType;
typedef NSInteger NSModalResponse;
#define NSModalResponseOK ((NSModalResponse)1)
#define NSModalResponseCancel ((NSModalResponse)0)
@interface NSSavePanel : NSPanel
@property(copy) NSArray<UTType*>* allowedContentTypes;
- (void)beginSheetModalForWindow:(NSWindow*)window completionHandler:(void (^)(NSModalResponse result))handler;
- (void)beginWithCompletionHandler:(void (^)(NSModalResponse result))handler;
@end
@interface NSOpenPanel : NSSavePanel
+ (NSOpenPanel*)openPanel;
@property BOOL canChooseFiles;
@property BOOL canChooseDirectories;
@property BOOL allowsMultipleSelection;
@property BOOL resolvesAliases;
@property(readonly, copy) NSArray<NSURL*>* URLs;
@end

typedef double NSTimeInterval;
@interface NSTimer : NSObject
+ (NSTimer*)timerWithTimeInterval:(NSTimeInterval)interval repeats:(BOOL)repeats block:(void (^)(NSTimer* timer))block;
@end
typedef NSString* NSRunLoopMode;
extern NSRunLoopMode const NSRunLoopCommonModes;
@interface NSRunLoop : NSObject
+ (NSRunLoop*)mainRunLoop;
- (void)addTimer:(NSTimer*)timer forMode:(NSRunLoopMode)mode;
@end
