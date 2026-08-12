// Mission Control — a native macOS shell around the hosted web app.
//
// The window is a plain WKWebView pointed at GitHub Pages, so a `git push`
// updates this app the same way it updates the phone. What the shell adds
// over a browser tab: a real menu bar, window state, and native handling for
// the things a bare WKWebView drops on the floor — file pickers, downloads,
// and JS dialogs. Without those, attachments and delete confirmations fail
// silently, so they are not optional.

import Cocoa
import WebKit

let appURL = URL(string: "https://studioelastik.github.io/elastik-board/elastik-board.html")!

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var web: WKWebView!

    func applicationDidFinishLaunching(_ note: Notification) {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()          // localStorage + the service worker cache persist

        // Report the page's theme up to native so the titlebar can follow it.
        let themeBridge = """
        (function () {
          function send() {
            try {
              window.webkit.messageHandlers.theme.postMessage(
                document.documentElement.getAttribute('data-theme') || 'light');
            } catch (e) {}
          }
          new MutationObserver(send).observe(document.documentElement,
            { attributes: true, attributeFilter: ['data-theme'] });
          document.addEventListener('DOMContentLoaded', send);
          send();
        })();
        """
        cfg.userContentController.addUserScript(
            WKUserScript(source: themeBridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.userContentController.add(self, name: "theme")

        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        if #available(macOS 13.3, *) { web.isInspectable = true }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Mission Control"
        // Unified titlebar: traffic lights float on a bar that blends into the
        // web toolbar underneath. Deliberately NOT fullSizeContentView — the
        // page's own toolbar would slide under the traffic lights.
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.minSize = NSSize(width: 900, height: 560)
        window.contentView = web
        window.center()
        window.setFrameAutosaveName("MissionControlWindow")
        window.makeKeyAndOrderFront(nil)

        buildMenu()
        web.load(URLRequest(url: appURL))
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    // Clicking the Dock icon with the window closed should bring it back.
    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    // MARK: Menu

    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Mission Control",
                        action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Mission Control",
                        action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "Hide Others",
                                         action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Show All",
                        action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Mission Control",
                        action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        // The notes editor is a text surface — without these, ⌘C/⌘V do nothing.
        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        let pastePlain = edit.addItem(withTitle: "Paste and Match Style",
                                      action: Selector(("pasteAsPlainText:")), keyEquivalent: "v")
        pastePlain.keyEquivalentModifierMask = [.command, .option, .shift]
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(editItem)

        let viewItem = NSMenuItem()
        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        let hardReload = view.addItem(withTitle: "Reload from Server",
                                      action: #selector(reloadIgnoringCache), keyEquivalent: "r")
        hardReload.keyEquivalentModifierMask = [.command, .shift]
        view.addItem(.separator())
        view.addItem(withTitle: "Actual Size", action: #selector(zoomReset), keyEquivalent: "0")
        view.addItem(withTitle: "Zoom In", action: #selector(zoomIn), keyEquivalent: "+")
        view.addItem(withTitle: "Zoom Out", action: #selector(zoomOut), keyEquivalent: "-")
        view.addItem(.separator())
        view.addItem(withTitle: "Enter Full Screen",
                     action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
            .keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = view
        main.addItem(viewItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize",
                           action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowItem.submenu = windowMenu
        main.addItem(windowItem)

        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu
    }

    @objc private func reload()               { web.reload() }
    @objc private func reloadIgnoringCache()  { web.reloadFromOrigin() }
    @objc private func zoomIn()               { web.pageZoom = min(web.pageZoom + 0.1, 3.0) }
    @objc private func zoomOut()              { web.pageZoom = max(web.pageZoom - 0.1, 0.5) }
    @objc private func zoomReset()            { web.pageZoom = 1.0 }
}

// MARK: - Theme bridge

extension AppDelegate: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "theme", let theme = message.body as? String else { return }
        let dark = (theme == "dark")
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.backgroundColor = dark
            ? NSColor(red: 0.118, green: 0.118, blue: 0.125, alpha: 1)   // --chrome dark
            : NSColor(red: 0.965, green: 0.965, blue: 0.965, alpha: 1)   // --chrome light
    }
}

// MARK: - Navigation

extension AppDelegate: WKNavigationDelegate {
    func webView(_ webView: WKWebView,
                 decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // An <a download> (attachment "Save") has to become a real download.
        if action.shouldPerformDownload { decisionHandler(.download); return }
        // Anything pointing off the app's own host belongs in the real browser.
        if action.navigationType == .linkActivated,
           let url = action.request.url, url.host != appURL.host {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    // Offline with a cold service-worker cache is the only real failure case;
    // say so plainly instead of leaving a blank window.
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showLoadFailure(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showLoadFailure(error)
    }

    private func showLoadFailure(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        let html = """
        <html><body style="font:14px -apple-system,sans-serif;color:#666;
          display:flex;align-items:center;justify-content:center;height:100vh;margin:0;
          text-align:center;background:#F6F6F6">
          <div><p style="font-size:15px;color:#111">Could not reach Mission Control.</p>
          <p>\(error.localizedDescription)</p>
          <p style="font-size:12px">Reconnect and press ⌘R.</p></div>
        </body></html>
        """
        web.loadHTMLString(html, baseURL: nil)
    }
}

// MARK: - Downloads

extension AppDelegate: WKDownloadDelegate {
    func download(_ download: WKDownload,
                  decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { result in
            guard result == .OK, let url = panel.url else { completionHandler(nil); return }
            try? FileManager.default.removeItem(at: url)   // NSSavePanel already confirmed the overwrite
            completionHandler(url)
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        presentAlert(text: "Download failed", info: error.localizedDescription)
    }
}

// MARK: - JS dialogs and file pickers

extension AppDelegate: WKUIDelegate {
    // target="_blank" and window.open() go to the default browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { result in
            completionHandler(result == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        presentAlert(text: message, info: nil)
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        let ok = alert.runModal() == .alertFirstButtonReturn
        completionHandler(ok ? field.stringValue : nil)
    }

    private func presentAlert(text: String, info: String?) {
        let alert = NSAlert()
        alert.messageText = text
        if let info { alert.informativeText = info }
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
