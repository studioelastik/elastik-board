import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import Darwin

/// Local-network helpers: finding the Mac's LAN address and rendering a QR code.
enum LANInfo {
    /// The Mac's primary IPv4 address on a physical interface (`en0`, `en1`, …),
    /// skipping loopback and self-assigned (169.254.x.x) addresses.
    static func primaryIPv4Address() -> String? {
        var pointer: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&pointer) == 0 else { return nil }
        defer { freeifaddrs(pointer) }

        var candidate: UnsafeMutablePointer<ifaddrs>? = pointer
        while let current = candidate {
            defer { candidate = current.pointee.ifa_next }

            guard let rawAddress = current.pointee.ifa_addr else { continue }
            guard rawAddress.pointee.sa_family == sa_family_t(AF_INET) else { continue }

            let name = String(cString: current.pointee.ifa_name)
            guard name.hasPrefix("en") else { continue }

            var address = rawAddress.pointee
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            let result = getnameinfo(
                &address,
                socklen_t(rawAddress.pointee.sa_len),
                &host,
                socklen_t(host.count),
                nil,
                0,
                NI_NUMERICHOST
            )
            guard result == 0 else { continue }

            let ip = String(cString: host)
            if ip != "127.0.0.1" && !ip.hasPrefix("169.254") {
                return ip
            }
        }
        return nil
    }

    /// The Mac's `.local` hostname (e.g. `Johns-MacBook.local`), if resolvable.
    static func localHostName() -> String? {
        let host = ProcessInfo.processInfo.hostName
        return host.isEmpty ? nil : host
    }

    /// Render `string` as a crisp QR code image of the requested point size.
    static func qrCode(from string: String, size: CGFloat = 240) -> NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage, output.extent.width > 0 else { return nil }

        let scale = size / output.extent.width
        let scaled = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))

        let representation = NSCIImageRep(ciImage: scaled)
        let image = NSImage(size: representation.size)
        image.addRepresentation(representation)
        return image
    }
}
