# iOS App Options

This document covers approaches to distributing Marginal Gains as a native iOS app while keeping it in sync with the web version.

## Current PWA Support

The app already has full PWA support:

- Web manifest (`public/manifest.webmanifest`)
- Service worker with push notifications (`public/sw.js`)
- Icons (192px, 512px, apple-touch-icon)
- `display: standalone` mode
- Theme color

**To install now**: Open in Safari → Share → "Add to Home Screen"

This works but won't get the app into the App Store.

---

## Options for App Store Distribution

### Option 1: WKWebView Wrapper

A minimal Swift app (~50 lines) that loads the hosted web app.

**Pros:**
- Full control over native code
- Minimal dependencies
- Small app size (~2MB)
- Easy to understand and debug

**Cons:**
- Native features require Swift code
- More manual work per feature

### Option 2: Capacitor

A framework that wraps web apps with native shell and plugin ecosystem.

**Pros:**
- Large plugin ecosystem
- JS APIs for native features
- Community maintained

**Cons:**
- Adds dependencies
- Larger app size (~8-15MB)
- Framework-mediated control (see below)
- Another abstraction layer to learn

---

## Capacitor in This Project

### How It Works

Capacitor has two modes:

**Bundled Mode (default)**: Copies `public/` into native project. App loads local files.
- Not ideal for server-rendered apps like Marginal Gains

**Remote URL Mode**: Loads hosted server URL, like a WKWebView wrapper.
```ts
// capacitor.config.ts
export default {
  appId: 'com.marginalgains.app',
  appName: 'Marginal Gains',
  server: {
    url: 'https://your-server.com',
    cleartext: true  // for http during dev
  }
};
```

### Project Structure with Capacitor

```
marginalgains/
├── public/
├── src/
├── ios/                      ← generated Xcode project
│   └── App/App/public/       ← copy of web assets (bundled mode)
├── capacitor.config.ts
└── package.json              ← adds @capacitor/core, @capacitor/ios
```

### Day-to-Day Commands

```bash
# Initial setup (once)
npm install @capacitor/core @capacitor/ios
npx cap init
npx cap add ios

# After config changes
npx cap sync

# Open Xcode
npx cap open ios
```

### Framework-Mediated Control

With WKWebView, you write Swift directly:
```swift
let activityVC = UIActivityViewController(
  activityItems: [url],
  applicationActivities: nil
)
present(activityVC, animated: true)
```

With Capacitor, you call JS APIs that invoke their Swift:
```js
import { Share } from '@capacitor/share';
await Share.share({ title: 'Check this', url: 'https://...' });
```

Trade-offs:
- Can't customize what Capacitor doesn't expose
- More debugging layers (JS → bridge → Swift)
- Dependent on plugin maintenance
- But: faster to implement common features

---

## Feature Comparison

| Feature | WKWebView | Capacitor |
|---------|-----------|-----------|
| Share TO other apps | ~20 lines Swift + JS bridge | `@capacitor/share` plugin |
| Receive shares FROM apps | Custom Swift + App Extension | Plugin available |
| Push notifications | Works (web push continues) | Works (web push or native) |
| Offline caching | Service worker | Service worker |
| App size | ~2MB | ~8-15MB |
| Dependencies | None | npm + Capacitor |

---

## Offline Caching

Neither wrapper improves offline - this is handled by the service worker.

Current `sw.js` only caches icons. For full offline support, expand to cache:
- HTML shell
- CSS/JS assets
- API responses (via IndexedDB)

This work is identical regardless of native wrapper choice.

---

## Recommendation

Given that Marginal Gains is server-rendered (not a static SPA):

**Use WKWebView wrapper** because:
1. Capacitor would run in "remote URL" mode anyway, negating bundling benefits
2. Share sheet is ~30 lines of Swift
3. Service worker handles offline regardless
4. Full control, no framework dependency

---

## WKWebView Implementation Sketch

### Project Structure

```
marginalgains-ios/
├── MarginalGains.xcodeproj
├── MarginalGains/
│   ├── AppDelegate.swift
│   ├── SceneDelegate.swift
│   ├── WebViewController.swift
│   ├── Info.plist
│   └── Assets.xcassets/
└── MarginalGains.entitlements
```

### Core WebViewController

```swift
import UIKit
import WebKit

class WebViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {

    private var webView: WKWebView!
    private let serverURL = URL(string: "https://your-server.com")!

    override func viewDidLoad() {
        super.viewDidLoad()

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "native")

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true

        view.addSubview(webView)
        webView.load(URLRequest(url: serverURL))
    }

    // Handle JS → Native messages
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }

        switch action {
        case "share":
            if let url = body["url"] as? String {
                shareURL(url)
            }
        default:
            break
        }
    }

    private func shareURL(_ urlString: String) {
        guard let url = URL(string: urlString) else { return }
        let activityVC = UIActivityViewController(
            activityItems: [url],
            applicationActivities: nil
        )
        present(activityVC, animated: true)
    }
}
```

### JS Bridge (add to web app)

```js
// Check if running in native wrapper
const isNativeApp = window.webkit?.messageHandlers?.native;

function shareNative(url) {
  if (isNativeApp) {
    window.webkit.messageHandlers.native.postMessage({ action: 'share', url });
  } else {
    // Fallback to Web Share API
    navigator.share?.({ url });
  }
}
```

### Info.plist Additions

```xml
<!-- Allow loading your server -->
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key>
    <false/>
    <key>NSExceptionDomains</key>
    <dict>
        <key>your-server.com</key>
        <dict>
            <key>NSExceptionAllowsInsecureHTTPLoads</key>
            <false/>
            <key>NSIncludesSubdomains</key>
            <true/>
        </dict>
    </dict>
</dict>

<!-- Push notification background modes -->
<key>UIBackgroundModes</key>
<array>
    <string>remote-notification</string>
</array>
```

---

## Receiving Shares (App Extension)

To let users share URLs/text TO Marginal Gains from other apps:

1. Add Share Extension target in Xcode
2. Configure activation rules in Info.plist
3. Handle incoming content, pass to main app
4. Main app opens with shared content

This is more involved (~100-200 lines) but doable in either approach.

---

## Next Steps

1. Test PWA install flow on iOS device
2. Create basic Xcode project with WKWebView
3. Add JS bridge for share functionality
4. Test on device via Xcode
5. (Optional) Add Share Extension for receiving shares
6. Configure App Store Connect for distribution
