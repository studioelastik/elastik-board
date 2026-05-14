// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ImageMirror",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "ImageMirror",
            resources: [
                .copy("Resources/web")
            ]
        )
    ]
)
