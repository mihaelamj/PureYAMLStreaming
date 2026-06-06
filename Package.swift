// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "PureYAMLStreaming",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .library(
            name: "PureYAMLStreaming",
            targets: ["PureYAMLStreaming"],
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/mihaelamj/PureYAML.git", branch: "main"),
    ],
    targets: [
        .target(
            name: "PureYAMLStreaming",
            dependencies: ["PureYAML"],
        ),
        .testTarget(
            name: "PureYAMLStreamingTests",
            dependencies: ["PureYAMLStreaming"],
        ),
    ],
)
