// Minimal stand-in for WebKit.h (Linux syntax check only; NOT the Apple SDK).
#pragma once
#include <Cocoa/Cocoa.h>
@class WKWebView, WKNavigation, WKOpenPanelParameters;
@interface WKOpenPanelParameters : NSObject
@property(readonly) BOOL allowsMultipleSelection;
@end
@interface WKFrameInfo : NSObject
@property(readonly, getter=isMainFrame) BOOL mainFrame;
@end
typedef NSInteger WKNavigationType;
#define WKNavigationTypeLinkActivated ((WKNavigationType)0)
typedef NSInteger WKNavigationActionPolicy;
#define WKNavigationActionPolicyCancel ((WKNavigationActionPolicy)0)
#define WKNavigationActionPolicyAllow ((WKNavigationActionPolicy)1)
@interface WKNavigationAction : NSObject
@property(readonly, copy) NSURLRequest* request;
@property(readonly) WKNavigationType navigationType;
@property(readonly, copy) WKFrameInfo* targetFrame;
@end
@interface WKWebsiteDataStore : NSObject
+ (WKWebsiteDataStore*)nonPersistentDataStore;
@end
@interface WKUserScript : NSObject
typedef NSInteger WKUserScriptInjectionTime;
#define WKUserScriptInjectionTimeAtDocumentStart ((WKUserScriptInjectionTime)0)
#define WKUserScriptInjectionTimeAtDocumentEnd ((WKUserScriptInjectionTime)1)
- (instancetype)initWithSource:(NSString*)source injectionTime:(WKUserScriptInjectionTime)time forMainFrameOnly:(BOOL)mainFrameOnly;
@end
@interface WKUserContentController : NSObject
- (void)addUserScript:(WKUserScript*)script;
- (void)removeAllUserScripts;
@end
@interface WKPreferences : NSObject
@end
@interface WKWebViewConfiguration : NSObject
@property(strong) WKPreferences* preferences;
@property(strong) WKUserContentController* userContentController;
@property(strong) WKWebsiteDataStore* websiteDataStore;
@end
@protocol WKNavigationDelegate <NSObject>
@optional
- (void)webView:(WKWebView*)webView decidePolicyForNavigationAction:(WKNavigationAction*)navigationAction decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler;
- (void)webViewWebContentProcessDidTerminate:(WKWebView*)webView;
- (void)webView:(WKWebView*)webView didFinishNavigation:(WKNavigation*)navigation;
- (void)webView:(WKWebView*)webView didFailNavigation:(WKNavigation*)navigation withError:(NSError*)error;
- (void)webView:(WKWebView*)webView didFailProvisionalNavigation:(WKNavigation*)navigation withError:(NSError*)error;
@end
@protocol WKUIDelegate <NSObject>
@optional
- (void)webView:(WKWebView*)webView runJavaScriptAlertPanelWithMessage:(NSString*)message initiatedByFrame:(WKFrameInfo*)frame completionHandler:(void (^)(void))completionHandler;
- (void)webView:(WKWebView*)webView runJavaScriptConfirmPanelWithMessage:(NSString*)message initiatedByFrame:(WKFrameInfo*)frame completionHandler:(void (^)(BOOL result))completionHandler;
- (void)webView:(WKWebView*)webView runJavaScriptTextInputPanelWithPrompt:(NSString*)prompt defaultText:(NSString*)defaultText initiatedByFrame:(WKFrameInfo*)frame completionHandler:(void (^)(NSString* result))completionHandler;
- (void)webView:(WKWebView*)webView runOpenPanelWithParameters:(WKOpenPanelParameters*)parameters initiatedByFrame:(WKFrameInfo*)frame completionHandler:(void (^)(NSArray<NSURL*>* URLs))completionHandler;
@end
@interface WKWebView : NSView
@property(weak) id<WKUIDelegate> UIDelegate;
@property(weak) id<WKNavigationDelegate> navigationDelegate;
@property(getter=isInspectable) BOOL inspectable;
@property(readonly, copy) NSURL* URL;
- (instancetype)initWithFrame:(NSRect)frame configuration:(WKWebViewConfiguration*)configuration;
- (WKNavigation*)loadRequest:(NSURLRequest*)request;
- (WKNavigation*)loadHTMLString:(NSString*)string baseURL:(NSURL*)baseURL;
- (void)evaluateJavaScript:(NSString*)javaScriptString completionHandler:(void (^)(id, NSError*))completionHandler;
@end
