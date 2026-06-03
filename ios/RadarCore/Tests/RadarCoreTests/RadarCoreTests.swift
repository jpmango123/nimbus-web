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

    func testNationalFramesParsing() async {
        let nowSec = Int(Date().timeIntervalSince1970)
        let payload = """
        {"host":"https://tc.rainviewer.com","radar":{"past":[
          {"time":\(nowSec - 600),"path":"/v2/radar/a"},
          {"time":\(nowSec - 300),"path":"/v2/radar/b"}
        ]}}
        """
        let fetch: RadarDataFetcher = { _ in Data(payload.utf8) }
        let frames = await framesForLoop(.national, defaultSite(), fetch: fetch)
        XCTAssertEqual(frames.count, 2)
        XCTAssertEqual(frames[0].national?.host, "https://tc.rainviewer.com")
        XCTAssertLessThan(frames[0].timestamp, frames[1].timestamp)
    }

    func testFramesGracefulOnGarbage() async {
        let fetch: RadarDataFetcher = { _ in Data("not json".utf8) }
        let local = await framesForLoop(.local, defaultSite(), fetch: fetch)
        let national = await framesForLoop(.national, defaultSite(), fetch: fetch)
        XCTAssertEqual(local, [])
        XCTAssertEqual(national, [])
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
