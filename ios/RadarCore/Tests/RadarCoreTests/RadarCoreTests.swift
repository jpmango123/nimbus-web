import XCTest
@testable import RadarCore

final class RadarCoreTests: XCTestCase {

    // MARK: site selection

    func testNearestSite() {
        XCTAssertEqual(nearestSite(43.66, -70.26).id, "GYX") // Portland
        XCTAssertEqual(nearestSite(42.36, -71.06).id, "BOX") // Boston
        XCTAssertEqual(nearestSite(40.71, -74.01).id, "OKX") // NYC
        XCTAssertEqual(nearestSite(46.0, -68.0).id, "CBW")   // Caribou
    }

    func testSelectSiteHysteresis() {
        let gyx = NEXRAD_SITES.first { $0.id == "GYX" }!
        // Center essentially on GYX -> stays GYX even if "current" is GYX.
        XCTAssertEqual(selectSite(43.9, -70.25, current: gyx).id, "GYX")
        // Deep in BOX territory -> swaps despite hysteresis.
        XCTAssertEqual(selectSite(42.0, -71.1, current: gyx).id, "BOX")
        // Fresh pick (no current) just returns nearest.
        XCTAssertEqual(selectSite(42.0, -71.1, current: nil).id, "BOX")
    }

    func testHysteresisHoldsNearBoundary() {
        let gyx = NEXRAD_SITES.first { $0.id == "GYX" }!
        // A point only marginally closer to BOX than GYX should NOT swap while
        // GYX is current (difference < 25 km).
        // Midpoint-ish between GYX(43.891,-70.256) and BOX(41.956,-71.137):
        let lat = 42.95, lon = -70.7
        let dGyx = haversineKm(lat, lon, gyx.lat, gyx.lon)
        let box = NEXRAD_SITES.first { $0.id == "BOX" }!
        let dBox = haversineKm(lat, lon, box.lat, box.lon)
        if abs(dGyx - dBox) < SITE_SWITCH_HYSTERESIS_KM {
            XCTAssertEqual(selectSite(lat, lon, current: gyx).id, "GYX",
                           "should hold current site inside the hysteresis band")
        }
    }

    // MARK: viewport

    func testSourcesForViewport() {
        let low = sourcesForViewport(43.9, -70.25, 6)
        XCTAssertEqual(low.map { $0.kind }, [.iemComposite])

        let high = sourcesForViewport(43.9, -70.25, 9)
        XCTAssertEqual(high.map { $0.kind }, [.iemComposite, .iemSingleSite])
        // composite drawn first (underneath)
        XCTAssertEqual(high.first?.kind, .iemComposite)
    }

    // MARK: stamps & URLs

    func testUtcStamp() {
        // 2026-06-03T16:43:00Z
        let epoch = 1_780_504_980_000.0
        XCTAssertEqual(utcStamp(epoch), "202606031643")
    }

    func testTileURLComposite() {
        XCTAssertEqual(tileURL(compositeSource(), nil), IEM_COMPOSITE_TILE)
    }

    func testTileURLSingleLatestAndFrame() {
        let gyx = NEXRAD_SITES.first { $0.id == "GYX" }!
        let src = singleSiteSource(gyx)
        // latest -> resolved {SITE}, /cache/ path, trailing -0
        let latest = tileURL(src, nil)
        XCTAssertTrue(latest.contains("ridge::GYX-N0B-0"))
        XCTAssertTrue(latest.contains("/cache/"))
        // timestamped frame -> /c/ path with the stamp
        let frame = RadarFrame(timestamp: 1_780_504_980_000.0,
                               single: .init(site: "GYX", stamp: "202606031643"))
        let url = tileURL(src, frame)
        XCTAssertTrue(url.contains("/c/"))
        XCTAssertTrue(url.contains("ridge::GYX-N0B-202606031643"))
    }

    func testTileURLRainviewer() {
        let frame = RadarFrame(timestamp: 0,
                               national: .init(host: "https://tilecache.rainviewer.com",
                                               path: "/v2/radar/1780504800"))
        let url = tileURL(rainviewerSource(), frame)
        XCTAssertEqual(url,
            "https://tilecache.rainviewer.com/v2/radar/1780504800/256/{z}/{x}/{y}/2/1_1.png")
    }

    // MARK: frame parsing (injected fetch — no network)

    func testLocalFramesParsing() async {
        let gyx = NEXRAD_SITES.first { $0.id == "GYX" }!
        let now = Date().timeIntervalSince1970
        let isoOlder = iso(now - 600)
        let isoNewer = iso(now - 300)
        let payload = "{\"scans\":[{\"ts\":\"\(isoNewer)\"},{\"ts\":\"\(isoOlder)\"}]}"
        let fetch: RadarDataFetcher = { _ in Data(payload.utf8) }

        let frames = await framesForLoop(.local, gyx, fetch: fetch)
        XCTAssertEqual(frames.count, 2)
        // sorted oldest -> newest
        XCTAssertLessThan(frames[0].timestamp, frames[1].timestamp)
        XCTAssertEqual(frames[0].single?.site, "GYX")
        XCTAssertNotNil(frames[1].single?.stamp)
    }

    func testCompositeFrames() async {
        // Composite frames are synthesized locally (no network) — oldest -> newest,
        // spanning the window in 5-min-aligned steps.
        let frames = await framesForLoop(.composite, defaultSite(), fetch: { _ in Data() })
        XCTAssertEqual(frames.count, COMPOSITE_WINDOW_MIN / COMPOSITE_STEP_MIN + 1)
        XCTAssertLessThan(frames.first!.timestamp, frames.last!.timestamp)
        // window spans ~COMPOSITE_WINDOW_MIN
        let spanMin = (frames.last!.timestamp - frames.first!.timestamp) / 60_000
        XCTAssertEqual(spanMin, Double(COMPOSITE_WINDOW_MIN), accuracy: 0.001)
        // timestamps are 5-min aligned
        XCTAssertEqual(frames.last!.timestamp.truncatingRemainder(dividingBy: 5 * 60_000), 0, accuracy: 0.001)
    }

    func testTileURLCompositeFrame() {
        let src = compositeSource()
        // no frame -> static /cache/ XYZ latest
        XCTAssertEqual(tileURL(src, nil), IEM_COMPOSITE_TILE)
        // timestamped frame -> WMS-T with the TIME substituted
        let f = tileURL(src, RadarFrame(timestamp: 0, composite: .init(time: "2026-06-03T17:00:00Z")))
        XCTAssertTrue(f.contains("n0q-t.cgi"))
        XCTAssertTrue(f.contains("time=2026-06-03T17:00:00Z"))
        XCTAssertTrue(f.contains("{bbox-epsg-3857}"))
    }

    func testFramesGracefulOnGarbage() async {
        let fetch: RadarDataFetcher = { _ in Data("not json".utf8) }
        let local = await framesForLoop(.local, defaultSite(), fetch: fetch)
        XCTAssertEqual(local, [])
    }

    func testFramesGracefulOnThrow() async {
        struct Boom: Error {}
        let fetch: RadarDataFetcher = { _ in throw Boom() }
        let frames = await framesForLoop(.local, defaultSite(), fetch: fetch)
        XCTAssertEqual(frames, [])
    }

    // helper
    private func iso(_ epochSec: Double) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: Date(timeIntervalSince1970: epochSec))
    }
}
