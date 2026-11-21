import XCTest

final class TextbookSmoke: XCTestCase {
    func testSelectShareAndAnnotate() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication(bundleIdentifier: "com.woongjin.thinkmeet")
        app.activate()
        let backToLesson = app.buttons["수업으로 돌아가기"]
        if backToLesson.exists { backToLesson.tap() }
        XCTAssertTrue(app.staticTexts["교재 페이지 검증"].waitForExistence(timeout: 10))

        let join = app.buttons["지금 참여하기"]
        for _ in 0..<3 where !join.isHittable { app.swipeUp() }
        XCTAssertTrue(join.isHittable)
        join.tap()
        if join.waitForExistence(timeout: 2) && join.isHittable { join.tap() }

        let materials = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "수업 자료")).firstMatch
        XCTAssertTrue(materials.waitForExistence(timeout: 15))
        materials.tap()
        let picker = app.staticTexts["교재 불러오기"]
        XCTAssertTrue(picker.waitForExistence(timeout: 15))
        let page = app.buttons["3쪽"]
        if !page.isHittable {
            let center = app.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.68))
            center.press(forDuration: 0.05, thenDragTo: center.withOffset(CGVector(dx: 0, dy: -200)))
        }
        XCTAssertTrue(page.isHittable)
        page.tap()
        capture("ios-phone-picker", app)
        app.buttons["3쪽 화면에 불러오기"].tap()

        let pen = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "판서 시작")).firstMatch
        XCTAssertTrue(pen.waitForExistence(timeout: 15))
        XCTAssertFalse(picker.exists)
        XCTAssertTrue(app.staticTexts["3 / 6쪽"].exists)
        pen.tap()
        let surface = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "수업 판서 영역")).firstMatch
        XCTAssertTrue(surface.exists)
        let clear = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "전체 지우기")).firstMatch
        XCTAssertTrue(clear.exists)
        XCTAssertGreaterThanOrEqual(clear.frame.minY, surface.frame.maxY)
        XCTAssertFalse(clear.isEnabled)

        let from = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.22, dy: 0.36))
        let to = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.68, dy: 0.57))
        from.press(forDuration: 0.1, thenDragTo: to)
        XCTAssertTrue(clear.isEnabled)
        capture("ios-phone-annotation", app)

        let undo = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "실행 취소")).firstMatch
        let redo = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "다시 실행")).firstMatch
        undo.tap()
        XCTAssertFalse(clear.isEnabled)
        redo.tap()
        XCTAssertTrue(clear.isEnabled)
    }

    private func capture(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
