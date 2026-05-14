import SwiftUI
import UniformTypeIdentifiers

/// The popover shown when the menu-bar icon is clicked: a drop zone, a paste
/// button, and the QR code / URL viewers use to connect.
struct MenuContentView: View {
    @EnvironmentObject private var model: AppModel
    @State private var isDropTargeted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            dropZone
            actionRow
            Divider()
            pairingSection
            Divider()
            footer
        }
        .padding(14)
        .frame(width: 320)
    }

    // MARK: - Sections

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: "rectangle.on.rectangle.angled")
            Text("Image Mirror").font(.headline)
            Spacer()
        }
    }

    private var dropZone: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(
                    style: StrokeStyle(lineWidth: 2, dash: [6])
                )
                .foregroundStyle(isDropTargeted ? Color.accentColor : Color.secondary.opacity(0.4))

            if let preview = model.currentImage?.preview {
                Image(nsImage: preview)
                    .resizable()
                    .interpolation(.high)
                    .aspectRatio(contentMode: .fit)
                    .padding(8)
            } else {
                VStack(spacing: 6) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 26))
                    Text("Drag an image here")
                        .font(.callout)
                }
                .foregroundStyle(.secondary)
            }
        }
        .frame(height: 150)
        .animation(.easeInOut(duration: 0.15), value: isDropTargeted)
        .onDrop(of: [.image, .fileURL], isTargeted: $isDropTargeted) { providers in
            model.handleDrop(providers: providers)
        }
    }

    private var actionRow: some View {
        HStack {
            Button {
                model.pasteFromClipboard()
            } label: {
                Label("Paste image", systemImage: "doc.on.clipboard")
            }
            Spacer()
            if model.currentImage != nil {
                Button(role: .destructive) {
                    model.clearImage()
                } label: {
                    Label("Clear", systemImage: "xmark.circle")
                }
            }
        }
    }

    private var pairingSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Open on your iPhone").font(.headline)

            if let qr = model.qrImage {
                HStack(alignment: .top, spacing: 12) {
                    Image(nsImage: qr)
                        .resizable()
                        .interpolation(.none)
                        .frame(width: 104, height: 104)
                        .padding(6)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 8))

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Scan with the Camera app, open the link, then **Add to Home Screen**.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)

                        if let url = model.serverURL {
                            urlLabel(url, prominent: true)
                        }
                        if let local = model.localHostURL, local != model.serverURL {
                            urlLabel(local, prominent: false)
                        }
                    }
                }
            } else {
                Text("Starting server…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var footer: some View {
        HStack {
            Text(model.statusText)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Button("Quit") {
                NSApplication.shared.terminate(nil)
            }
        }
    }

    // MARK: - Helpers

    private func urlLabel(_ url: URL, prominent: Bool) -> some View {
        Text(url.absoluteString)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(prominent ? Color.primary : Color.secondary)
            .textSelection(.enabled)
            .lineLimit(1)
            .truncationMode(.middle)
    }
}
