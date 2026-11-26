import { test, expect, type Page } from "@playwright/test"
import fs from "node:fs/promises"
import path from "node:path"

test.use({ baseURL: process.env.ASSISTANCE_BASE_URL || "http://127.0.0.1:8443" })
test.skip(!process.env.ASSISTANCE_BASE_URL, "Requires ASSISTANCE_BASE_URL pointing to a local Vite development server")
const fixtureHtml = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;
</script><script type="module" src="/@vite/client"></script><script type="module" src="/e2e/fixtures/remote-assistance.tsx"></script></body></html>`

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/capabilities", route => route.fulfill({ json: { contractRevision: 4, features: { "classroom.core": true, "meeting.remote-assistance": true } } }))
  await page.route("**/__remote_assistance_test", route => route.fulfill({ contentType: "text/html", body: fixtureHtml }))
  await page.goto("/__remote_assistance_test")
  await expect(page.getByRole("button", { name: "김학생 화면 보기 요청", exact: true })).toBeVisible()
})

async function activate(page: Page) {
  await page.getByRole("button", { name: "김학생 화면 보기 요청", exact: true }).click()
  await expect(page.locator(".remote-assistance-status")).toContainText("학생의 수락을 기다리고 있어요")
  await page.getByRole("button", { name: "학생 승인", exact: true }).click()
  await expect(page.locator(".remote-assistance-status")).toContainText("전체 화면 공유를 준비하고 있어요")
  await page.getByRole("button", { name: "학생 공유 시작", exact: true }).click()
  await page.getByRole("button", { name: "참석자 전환", exact: true }).click()
  await expect(page.locator(".annotation-overlay")).toHaveClass(/is-drawing/)
}

test("teacher requests a student's screen, waits for consent and can cancel", async ({ page }) => {
  await page.getByRole("button", { name: "더보기 열기", exact: true }).click()
  await page.getByRole("button", { name: "학생 화면 보기", exact: false }).click()
  const request = page.getByRole("button", { name: "김학생 화면 보기 요청", exact: true })
  await expect(request).toHaveText("화면 보기 요청")
  await request.click()
  await expect(request).toBeDisabled()
  await expect(page.locator(".remote-assistance-status")).toContainText("학생의 수락을 기다리고 있어요")
  await expect(page.locator(".content-surface")).toHaveCount(0)
  await page.getByRole("button", { name: "화면 안내 중지", exact: true }).click()
  await expect(page.locator(".remote-assistance-status")).toHaveCount(0)
  await expect(request).toBeEnabled()
  expect(await page.getByTestId("commands").textContent()).toBe('["assistance.request","assistance.stop"]')
})

test("teacher click sends one normalized pulse that stays after release and never saves a stroke", async ({ page }) => {
  await activate(page)
  const surface = page.locator(".content-surface")
  const rect = (await surface.boundingBox())!
  await surface.click({ position: { x: rect.width * .25, y: rect.height * .75 } })
  await expect(page.getByTestId("remote-pointer")).toBeVisible()
  const frames = JSON.parse((await page.getByTestId("frames").textContent())!)
  expect(frames).toHaveLength(1)
  expect(frames[0]).toMatchObject({ sessionId: "session", shareId: "student-screen", geometryVersion: 1 })
  expect(frames[0].x).toBeCloseTo(.25, 2)
  expect(frames[0].y).toBeCloseTo(.75, 2)
  expect(await page.getByTestId("commands").textContent()).toBe('["assistance.request"]')
  await expect(page.getByRole("button", { name: "판서 시작", exact: true })).toHaveCount(0)
  await expect(page.getByTestId("remote-pointer")).toHaveCount(0)
})

test("teacher drag follows the held mouse, stays visible while stationary and expires after release", async ({ page }) => {
  await activate(page)
  await page.clock.install()
  const rect = (await page.locator(".content-surface").boundingBox())!
  await page.mouse.move(rect.x + rect.width * .25, rect.y + rect.height * .25)
  expect(JSON.parse((await page.getByTestId("frames").textContent())!)).toHaveLength(0)
  await page.mouse.down()
  await page.mouse.move(rect.x + rect.width * .75, rect.y + rect.height * .6, { steps: 4 })
  const moved = JSON.parse((await page.getByTestId("frames").textContent())!)
  expect(moved.length).toBeGreaterThan(1)
  expect(moved.at(-1).x).toBeCloseTo(.75, 2)
  expect(moved.at(-1).y).toBeCloseTo(.6, 2)
  await page.clock.runFor(2000) // Longer than the student's existing 1.5-second expiry.
  await expect(page.getByTestId("remote-pointer")).toBeVisible()
  const sent = JSON.parse((await page.getByTestId("frames").textContent())!).length
  expect(sent).toBeGreaterThan(moved.length)
  await page.mouse.up()
  await page.mouse.move(rect.x + rect.width * .5, rect.y + rect.height * .5)
  await page.clock.runFor(2000)
  await expect(page.getByTestId("remote-pointer")).toHaveCount(0)
  expect(JSON.parse((await page.getByTestId("frames").textContent())!)).toHaveLength(sent)
  expect(await page.getByTestId("commands").textContent()).toBe('["assistance.request"]')
})

test("held pointer stops on disconnect and does not resume without a new press", async ({ page }) => {
  await activate(page)
  await page.clock.install()
  const rect = (await page.locator(".content-surface").boundingBox())!
  await page.mouse.move(rect.x + rect.width * .5, rect.y + rect.height * .5)
  await page.mouse.down()
  const connection = page.getByRole("button", { name: "연결 전환", exact: true })
  await connection.evaluate(button => button.click())
  await expect(page.locator(".annotation-overlay")).not.toHaveClass(/is-drawing/)
  const sent = JSON.parse((await page.getByTestId("frames").textContent())!).length
  await connection.evaluate(button => button.click())
  await expect(page.locator(".annotation-overlay")).toHaveClass(/is-drawing/)
  await page.clock.runFor(2000)
  expect(JSON.parse((await page.getByTestId("frames").textContent())!)).toHaveLength(sent)
  await page.mouse.up()
})

test("rotation disables coordinates until video dimensions match and rejects the old version", async ({ page }) => {
  await activate(page)
  await page.locator(".content-surface").click()
  await expect(page.getByTestId("remote-pointer")).toBeVisible()
  await page.getByRole("button", { name: "회전", exact: true }).click()
  await expect(page.getByTestId("remote-pointer")).toHaveCount(0)
  await expect(page.locator(".annotation-overlay")).not.toHaveClass(/is-drawing/)
  await page.locator(".content-surface").click()
  expect(JSON.parse((await page.getByTestId("frames").textContent())!)).toHaveLength(1)
  await page.getByRole("button", { name: "영상 회전 반영", exact: true }).click()
  await expect(page.locator(".annotation-overlay")).toHaveClass(/is-drawing/)
  await page.locator(".content-surface").click()
  expect(JSON.parse((await page.getByTestId("frames").textContent())!).at(-1).geometryVersion).toBe(2)
})

test("web student gets Android guidance without approval or pointer controls", async ({ page }) => {
  await activate(page)
  await page.getByRole("button", { name: "역할 전환", exact: true }).click()
  await expect(page.locator(".remote-assistance-status")).toContainText("Android 학생 기기에서만 지원해요")
  await expect(page.getByRole("button", { name: "승인하고 화면 공유", exact: true })).toHaveCount(0)
  await expect(page.locator(".annotation-overlay")).not.toHaveClass(/is-drawing/)
  await page.locator(".content-surface").click()
  expect(JSON.parse((await page.getByTestId("frames").textContent())!)).toHaveLength(0)
})

test("same-aspect 180 degree rotation also pauses teacher input", async ({ page }) => {
  await activate(page)
  await page.getByRole("button", { name: "같은 비율 회전", exact: true }).click()
  await expect(page.locator(".annotation-overlay")).not.toHaveClass(/is-drawing/)
  await expect(page.locator(".remote-assistance-status")).toContainText("화면 방향을 맞추고 있어요")
  await page.locator(".content-surface").click()
  expect(JSON.parse((await page.getByTestId("frames").textContent())!)).toHaveLength(0)
  await expect(page.locator(".annotation-overlay")).toHaveClass(/is-drawing/)
})

test("disconnect and feature revocation disable pointing while keeping cleanup", async ({ page }) => {
  await activate(page)
  await page.locator(".content-surface").click()
  await page.getByRole("button", { name: "연결 전환", exact: true }).click()
  await expect(page.getByTestId("remote-pointer")).toHaveCount(0)
  await expect(page.locator(".annotation-overlay")).not.toHaveClass(/is-drawing/)
  await page.getByRole("button", { name: "연결 전환", exact: true }).click()
  await expect(page.locator(".annotation-overlay")).toHaveClass(/is-drawing/)
  await page.locator(".content-surface").click()
  await expect(page.getByTestId("remote-pointer")).toBeVisible()
  await page.route("**/api/v1/capabilities", route => route.fulfill({ json: { contractRevision: 4, features: { "classroom.core": true, "meeting.remote-assistance": false } } }))
  await page.getByRole("button", { name: "지원 새로고침", exact: true }).click()
  await expect(page.getByTestId("remote-pointer")).toHaveCount(0)
  await expect(page.locator(".annotation-overlay")).not.toHaveClass(/is-drawing/)
  await expect(page.getByRole("button", { name: "화면 안내 중지", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "화면 안내 중지", exact: true }).click()
  await expect(page.locator(".remote-assistance-status")).toHaveCount(0)
})

for (const [name, size] of Object.entries({ phone: { width: 390, height: 844 }, tablet: { width: 1024, height: 1366 }, desktop: { width: 1440, height: 1000 } })) {
  test(`${name} teacher shows the active Android student screen with mapped pointer`, async ({ page }) => {
    await page.setViewportSize(size)
    await page.getByRole("button", { name: "김학생 화면 보기 요청", exact: true }).click()
    await expect(page.getByRole("button", { name: "김학생 화면 보기 요청", exact: true })).toBeDisabled()
    const evidence = path.resolve("../features/evidence/remote-assistance")
    await fs.mkdir(evidence, { recursive: true })
    const fixtureStyle = await page.addStyleTag({ content: ".fixture-controls { display:none !important; }" })
    await page.screenshot({ animations: "disabled", path: path.join(evidence, `web-${name}-teacher-request.png`) })
    await fixtureStyle.evaluate(element => element.remove())
    // Native controls and consent happen on the Android student device; this fixture models snapshots.
    await page.getByRole("button", { name: "학생 공유 시작", exact: true }).click()
    await page.getByRole("button", { name: "참석자 전환", exact: true }).click()
    await page.addStyleTag({ content: ".fixture-controls { display:none !important; }" })
    await expect(page.locator(".annotation-overlay")).toHaveClass(/is-drawing/)
    const rect = (await page.locator(".content-surface").boundingBox())!
    await page.locator(".content-surface").click({ position: { x: rect.width * .5, y: rect.height * .52 } })
    const marker = (await page.getByTestId("remote-pointer").boundingBox())!
    expect(marker.x + marker.width / 2).toBeCloseTo(rect.x + rect.width * .5, 0)
    expect(marker.y + marker.height / 2).toBeCloseTo(rect.y + rect.height * .52, 0)
    await page.screenshot({ animations: "disabled", path: path.join(evidence, `web-${name}-teacher-active.png`) })
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.width).toBeLessThanOrEqual(size.width)
  })
}

async function activateDevice(page: Page, platform: "Android" | "iOS") {
  await page.route("**/api/v1/capabilities", route => route.fulfill({ json: { contractRevision: 16, features: { "classroom.core": true, "meeting.remote-assistance": true, "meeting.remote-annotation": true } } }))
  await page.getByRole("button", { name: "지원 새로고침", exact: true }).click()
  await page.getByRole("button", { name: "김학생 화면 보기 요청", exact: true }).click()
  await page.getByRole("button", { name: "학생 승인", exact: true }).click()
  await page.getByRole("button", { name: `${platform} 학생 공유 시작`, exact: true }).click()
  await page.getByRole("button", { name: "참석자 전환", exact: true }).click()
  await expect(page.locator(".annotation-overlay")).toHaveClass(/is-drawing/)
}

test("Android student session starts with the pointer and saves pen strokes for the student's screen", async ({ page }) => {
  await activateDevice(page, "Android")
  await expect(page.locator(".remote-assist-hint")).toHaveText("포인터로 위치를 알리거나 펜으로 학생 화면에 판서해 주세요")
  await expect(page.getByRole("button", { name: "포인터", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "판서 종료", exact: true })).toHaveCount(0)
  const surface = page.locator(".content-surface")
  const rect = (await surface.boundingBox())!
  await surface.click({ position: { x: rect.width * .5, y: rect.height * .5 } })
  expect(JSON.parse((await page.getByTestId("frames").textContent())!)).toHaveLength(1)

  await page.getByRole("button", { name: "펜", exact: true }).click()
  await page.mouse.move(rect.x + rect.width * .2, rect.y + rect.height * .3)
  await page.mouse.down()
  await page.mouse.move(rect.x + rect.width * .8, rect.y + rect.height * .4, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(1)
  expect(JSON.parse((await page.getByTestId("commands").textContent())!)).toEqual(["assistance.request", "stroke.add"])
  expect(JSON.parse((await page.getByTestId("frames").textContent())!)).toHaveLength(1)
  expect(Number(await page.getByTestId("previews").textContent())).toBeGreaterThan(0)
  if (process.env.ASSISTANCE_EVIDENCE_DIR) await page.screenshot({ path: path.join(process.env.ASSISTANCE_EVIDENCE_DIR, `web-${page.viewportSize()!.width}-teacher-android-annotation.png`) })

  await page.getByRole("button", { name: "전체 지우기", exact: true }).click()
  await page.getByRole("button", { name: "지우기", exact: true }).click()
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(0)
})

test("iOS student session hides annotation tools and keeps only the pointer", async ({ page }) => {
  await activateDevice(page, "iOS")
  await expect(page.locator(".remote-assist-hint")).toContainText("판서할 수 없어요")
  await expect(page.getByRole("button", { name: "펜", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "포인터", exact: true })).toHaveCount(0)
  const rect = (await page.locator(".content-surface").boundingBox())!
  await page.mouse.move(rect.x + rect.width * .2, rect.y + rect.height * .3)
  await page.mouse.down()
  await page.mouse.move(rect.x + rect.width * .8, rect.y + rect.height * .4, { steps: 4 })
  await page.mouse.up()
  expect(JSON.parse((await page.getByTestId("frames").textContent())!).length).toBeGreaterThan(1)
  expect(await page.getByTestId("commands").textContent()).toBe('["assistance.request"]')
  if (process.env.ASSISTANCE_EVIDENCE_DIR) await page.screenshot({ path: path.join(process.env.ASSISTANCE_EVIDENCE_DIR, `web-${page.viewportSize()!.width}-teacher-ios-pointer-only.png`) })
})
