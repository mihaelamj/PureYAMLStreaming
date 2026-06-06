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
        .executable(
            name: "pureyaml-streaming-wasm-smoke",
            targets: ["PureYAMLStreamingWasmSmoke"],
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
        .executableTarget(
            name: "PureYAMLStreamingWasmSmoke",
            dependencies: ["PureYAMLStreaming", "PureYAML"],
        ),
        .testTarget(
            name: "PureYAMLStreamingTests",
            dependencies: ["PureYAMLStreaming"],
        ),
    ],
)
