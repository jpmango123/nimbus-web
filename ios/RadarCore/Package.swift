// swift-tools-version: 5.9
import PackageDescription

// RadarCore — platform-agnostic radar logic for the Nimbus iOS app.
// This is a standalone SwiftPM package so the pure logic can be unit-tested
// off-device (macOS / Linux Swift). Drop the `RadarCore` source into the iOS
// app, then add the thin MapLibre Native adapter (RadarMapController) on top.
let package = Package(
    name: "RadarCore",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [
        .library(name: "RadarCore", targets: ["RadarCore"]),
    ],
    targets: [
        .target(name: "RadarCore"),
        .testTarget(name: "RadarCoreTests", dependencies: ["RadarCore"]),
    ]
)
