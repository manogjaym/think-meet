import { expect, test, type Page } from "@playwright/test"
import type { MeetingSnapshot } from "../src/lib/meeting"

type Message = MeetingSnapshot["messages"][number]
test.use({ baseURL: process.env.CHAT_BASE_URL || "http://127.0.0.1:8443" })
test.skip(!process.env.CHAT_BASE_URL, "Requires CHAT_BASE_URL pointing to a local Vite server")

const fixtureHtml = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script><script type="module" src="/@vite/client"></script><script type="module" src="/e2e/fixtures/chat-notifications.tsx"></script></body></html>`

function message(id: string, text = "다음 문제를 함께 풀어 볼까요?", userId = "teacher"): Message {
  return { id, clientId: id, userId, userName: userId === "teacher" ? "윤지아" : "김민준", text, createdAt: new Date().toISOString() }
}
async function update(page: Page, data: { append?: Message[]; replace?: Message[]; lessonId?: string; userId?: string; rerender?: boolean }) {
  await page.evaluate(payload => window.dispatchEvent(new CustomEvent("chat-fixture", { detail: payload })), data)
}
const toast = (page: Page) => page.getByTestId("chat-notification")
const chatButton = (page: Page) => page.locator(".call-controls button").filter({ hasText: "채팅" })
const unreadButton = (page: Page, count: number) => page.locator(".call-controls").getByRole("button", { name: `채팅, 읽지 않은 메시지 ${count}개`, exact: true })

test.beforeEach(async ({ page }) => {
  await page.route("**/__chat_notifications_test", route => route.fulfill({ contentType: "text/html", body: fixtureHtml }))
  await page.goto("/__chat_notifications_test")
  await expect(page.getByTestId("chat-fixture")).toBeVisible()
  await expect(chatButton(page)).toHaveAttribute("aria-expanded", "false")
})

test("incoming messages notify closed chat; opening reads them and visible chat stays quiet", async ({ page }) => {
  await expect(toast(page)).toHaveCount(0)
  await update(page, { append: [message("self", "내가 보낸 채팅", "student")] })
  await expect(toast(page)).toHaveCount(0)
  await expect(chatButton(page)).toHaveAccessibleName("채팅")

  await update(page, { append: [message("incoming-one")] })
  await expect(toast(page)).toContainText("윤지아")
  await expect(toast(page)).toContainText("다음 문제를 함께 풀어 볼까요?")
  await expect(unreadButton(page, 1)).toBeVisible()
  await toast(page).getByRole("button", { name: "채팅 열기" }).click()
  await expect(chatButton(page)).toHaveAttribute("aria-expanded", "true")
  await expect(toast(page)).toHaveCount(0)
  await expect(chatButton(page)).toHaveAccessibleName("채팅")
  await expect(page.locator(".messages")).toContainText("다음 문제를 함께 풀어 볼까요?")

  await update(page, { append: [message("incoming-open", "채팅창을 보고 있을 때")] })
  await expect(page.locator(".messages")).toContainText("채팅창을 보고 있을 때")
  await expect(toast(page)).toHaveCount(0)
  await expect(chatButton(page)).toHaveAccessibleName("채팅")
  await page.locator(".side-panel > header").getByRole("button", { name: "패널 닫기" }).click()
  await update(page, { append: [message("incoming-after-close", "닫은 뒤 새 메시지")] })
  await expect(toast(page)).toContainText("닫은 뒤 새 메시지")
  await expect(unreadButton(page, 1)).toBeVisible()
})

test("dismissal retains unread messages and repeated snapshots do not notify twice", async ({ page }) => {
  await update(page, { append: [message("batch-one"), message("batch-two", "마지막 메시지")] })
  await expect(unreadButton(page, 2)).toBeVisible()
  await expect(toast(page)).toContainText("마지막 메시지")
  await toast(page).getByRole("button", { name: "채팅 알림 닫기" }).click()
  await expect(toast(page)).toHaveCount(0)
  await expect(unreadButton(page, 2)).toBeVisible()
  await update(page, { rerender: true })
  await expect(toast(page)).toHaveCount(0)
  await expect(unreadButton(page, 2)).toBeVisible()
  await update(page, { append: [message("batch-three", "재연결 뒤 새 메시지")] })
  await expect(unreadButton(page, 3)).toBeVisible()
  await expect(toast(page)).toContainText("재연결 뒤 새 메시지")
})

test("a full 100-message window still detects a new message without relying on length", async ({ page }) => {
  const history = Array.from({ length: 100 }, (_, index) => message(`history-${index}`, `기록 ${index}`))
  await update(page, { lessonId: "history-room", replace: history })
  await expect(toast(page)).toHaveCount(0)
  await expect(chatButton(page)).toHaveAccessibleName("채팅")
  const rolled = [...history.slice(1), message("rollover", "새로운 101번째 메시지")]
  await update(page, { replace: rolled })
  await expect(toast(page)).toContainText("새로운 101번째 메시지")
  await expect(unreadButton(page, 1)).toBeVisible()
  await update(page, { replace: rolled.map(item => ({ ...item })) })
  await expect(unreadButton(page, 1)).toBeVisible()
  await update(page, { lessonId: "another-room", replace: [message("different-old")] })
  await expect(toast(page)).toHaveCount(0)
  await expect(chatButton(page)).toHaveAccessibleName("채팅")
})

test("notification expires after eight seconds while its unread badge remains", async ({ page }) => {
  await page.clock.install()
  await update(page, { append: [message("expiry")] })
  await expect(toast(page)).toBeVisible()
  await page.clock.runFor(8_100)
  await expect(toast(page)).toHaveCount(0)
  await expect(unreadButton(page, 1)).toBeVisible()
})

test("viewing participants still notifies and the chat tab clears unread messages", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "참가자 2명", exact: true }).click()
  await expect(page.locator(".participant-tabs")).toBeVisible()
  await update(page, { replace: Array.from({ length: 100 }, (_, index) => message(`unread-${index}`, `읽지 않은 메시지 ${index + 1}`)) })
  await expect(unreadButton(page, 100)).toBeVisible()
  await expect(page.locator(".call-controls .control-chat-unread")).toHaveText("99+")
  await expect(page.locator(".participant-tabs .chat-unread-badge")).toHaveText("99+")
  await expect(toast(page)).toContainText("읽지 않은 메시지 100")
  // The preview remains actionable above the mobile panel and its backdrop.
  await toast(page).getByRole("button", { name: "채팅 열기" }).click()
  await expect(chatButton(page)).toHaveAttribute("aria-expanded", "true")
  await expect(toast(page)).toHaveCount(0)
  await expect(chatButton(page)).toHaveAccessibleName("채팅")
  await page.locator(".side-panel > header").getByRole("button", { name: "패널 닫기" }).click()
  await page.getByRole("button", { name: "참가자 2명", exact: true }).click()
  await update(page, { append: [message("people-panel", "참석자 목록을 보고 있을 때")] })
  await expect(toast(page)).toContainText("참석자 목록을 보고 있을 때")
  await expect(unreadButton(page, 1)).toBeVisible()
  await page.locator(".participant-tabs").getByRole("button", { name: "채팅, 읽지 않은 메시지 1개", exact: true }).click()
  await expect(page.locator(".messages")).toContainText("참석자 목록을 보고 있을 때")
  await expect(chatButton(page)).toHaveAccessibleName("채팅")
  await expect(toast(page)).toHaveCount(0)
})

test("notification stays readable above meeting controls on desktop and narrow mobile", async ({ page }, testInfo) => {
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await update(page, { append: [message(`layout-${width}`, "긴 채팅도 화면 밖으로 밀리지 않고 읽을 수 있어야 해요. ".repeat(12))] })
    await expect(toast(page)).toBeVisible()
    const notification = (await toast(page).boundingBox())!
    const controls = (await page.locator(".call-controls").boundingBox())!
    expect(notification.x).toBeGreaterThanOrEqual(0)
    expect(notification.x + notification.width).toBeLessThanOrEqual(width)
    expect(notification.y).toBeGreaterThanOrEqual(0)
    expect(notification.y + notification.height).toBeLessThanOrEqual(controls.y)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${width}-chat-notification.png`), animations: "disabled" })
  }
})
