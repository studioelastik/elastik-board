import SwiftUI

@main
struct ImageMirrorApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel()

    var body: some Scene {
        MenuBarExtra {
            MenuContentView()
                .environmentObject(model)
        } label: {
            Image(systemName: "rectangle.on.rectangle.angled")
        }
        .menuBarExtraStyle(.window)
    }
}

/// Keeps the app out of the Dock and the ⌘-Tab switcher — it lives entirely in
/// the menu bar.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }
}
