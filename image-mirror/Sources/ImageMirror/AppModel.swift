import AppKit
import Foundation
import SwiftUI
import UniformTypeIdentifiers

/// The image currently mirrored, plus a small preview for the menu-bar popover.
struct DisplayImage {
    let version: Int
    let preview: NSImage?
}

/// Owns the embedded server and the image being mirrored. The single source of
/// truth shared between the menu-bar UI and the HTTP server.
@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var currentImage: DisplayImage?
    @Published private(set) var serverURL: URL?
    @Published private(set) var localHostURL: URL?
    @Published private(set) var qrImage: NSImage?
    @Published private(set) var viewerCount: Int = 0

    private let server: HTTPServer
    private var version = 0

    var statusText: String {
        guard let serverURL else { return "Starting server…" }
        let viewers = viewerCount == 1 ? "1 viewer" : "\(viewerCount) viewers"
        return "Serving on port \(serverURL.port.map(String.init) ?? "?") · \(viewers)"
    }

    init() {
        let webRoot = Bundle.module.url(forResource: "web", withExtension: nil)
        server = HTTPServer(webRoot: webRoot)

        // The server invokes these on the main queue, but they are plain
        // (non-isolated) closures, so hop onto the main actor explicitly.
        server.onReady = { [weak self] port in
            Task { @MainActor in self?.handleServerReady(port: port) }
        }
        server.onClientCountChange = { [weak self] count in
            Task { @MainActor in self?.viewerCount = count }
        }
        server.start()
    }

    // MARK: - Server callbacks

    private func handleServerReady(port: UInt16) {
        if let ip = LANInfo.primaryIPv4Address() {
            serverURL = URL(string: "http://\(ip):\(port)/")
        }
        if let host = LANInfo.localHostName() {
            localHostURL = URL(string: "http://\(host):\(port)/")
        }
        if let url = serverURL ?? localHostURL {
            qrImage = LANInfo.qrCode(from: url.absoluteString)
        }
    }

    // MARK: - Image input

    /// Handle images dropped onto the popover's drop zone.
    func handleDrop(providers: [NSItemProvider]) -> Bool {
        guard let provider = providers.first else { return false }

        if provider.canLoadObject(ofClass: NSImage.self) {
            provider.loadObject(ofClass: NSImage.self) { [weak self] object, _ in
                guard let image = object as? NSImage else { return }
                Task { @MainActor in self?.setImage(image) }
            }
            return true
        }

        let fileURLType = UTType.fileURL.identifier
        if provider.hasItemConformingToTypeIdentifier(fileURLType) {
            provider.loadDataRepresentation(forTypeIdentifier: fileURLType) { [weak self] data, _ in
                guard
                    let data,
                    let string = String(data: data, encoding: .utf8),
                    let url = URL(string: string),
                    let image = NSImage(contentsOf: url)
                else { return }
                Task { @MainActor in self?.setImage(image) }
            }
            return true
        }

        return false
    }

    /// Pull an image straight off the system clipboard (⌘V equivalent).
    func pasteFromClipboard() {
        guard let image = NSImage(pasteboard: .general) else {
            NSSound.beep()
            return
        }
        setImage(image)
    }

    /// Stop mirroring; viewers fall back to their placeholder.
    func clearImage() {
        version += 1
        currentImage = nil
        server.clear(version: version)
    }

    // MARK: - Internal

    private func setImage(_ image: NSImage) {
        guard let png = image.pngData() else {
            NSSound.beep()
            return
        }
        version += 1
        currentImage = DisplayImage(version: version, preview: NSImage(data: png))
        server.publish(data: png, contentType: "image/png", version: version)
    }
}

private extension NSImage {
    /// Re-encode whatever the image holds as PNG, so the server always serves
    /// one predictable format regardless of where the image came from.
    func pngData() -> Data? {
        guard
            let tiff = tiffRepresentation,
            let bitmap = NSBitmapImageRep(data: tiff)
        else { return nil }
        return bitmap.representation(using: .png, properties: [:])
    }
}
