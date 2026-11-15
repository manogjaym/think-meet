import { test, expect, type Page } from "@playwright/test"
import type { ApiLesson, User } from "../src/lib/api"

// All account and lesson data is intercepted: this suite never edits a live room.
const teacher: User = {
  id: "teacher-fixture",
  username: "teacher1",
  name: "윤지아",
  role: "teacher",
}
const students: User[] = [
  { id: "student-1", username: "student1", name: "김민준", role: "student" },
  { id: "student-2", username: "student2", name: "이서윤", role: "student" },
  { id: "student-3", username: "student3", name: "박지후", role: "student" },
  { id: "student-4", username: "student4", name: "최하은", role: "student" },
]

function lessonFixtures(): ApiLesson[] {
  const base = {
    description: "화면 동작 검증용 수업",
    teacher,
    code: "fixture-code",
    startedAt: "2026-11-09T06:00:00.000Z",
    endedAt: null,
  }
  return [
    {
      ...base,
      id: "live-first",
      title: "분수 연습",
      status: "LIVE",
      startsAt: "2026-11-09T06:00:00.000Z",
      endsAt: "2026-11-09T06:40:00.000Z",
      students: students.slice(0, 2),
      participants: [teacher, students[0]].map((user) => ({
        userId: user.id,
        joinedAt: base.startedAt,
      })),
    },
    {
      ...base,
      id: "live-second",
      title: "덧셈의 이해",
      status: "LIVE",
      startsAt: "2026-11-09T07:00:00.000Z",
      endsAt: "2026-11-09T07:50:00.000Z",
      students: [students[0], students[2], students[3]],
      participants: [teacher, students[2], students[3]].map((user) => ({
        userId: user.id,
        joinedAt: base.startedAt,
      })),
    },
    {
      ...base,
      id: "upcoming-fixture",
      title: "삼각형의 넓이",
      status: "SCHEDULED",
      startsAt: "2026-11-10T07:00:00.000Z",
      endsAt: "2026-11-10T07:50:00.000Z",
      students: [students[0]],
      startedAt: null,
      participants: [],
    },
    {
      ...base,
      id: "history-fixture",
      title: "지난 곱셈 수업",
      status: "ENDED",
      startsAt: "2026-11-08T07:00:00.000Z",
      endsAt: "2026-11-08T07:50:00.000Z",
      students: [students[0]],
      endedAt: "2026-11-08T07:50:00.000Z",
      participants: [],
    },
  ]
}

async function mockDashboard(page: Page, user: User = teacher) {
  let lessons = lessonFixtures()
  let listRequests = 0
  const unexpectedRequests: string[] = []
  await page.route("**/socket.io/**", (route) => route.abort())
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== "GET") {
      unexpectedRequests.push(`${route.request().method()} ${path}`)
      await route.fulfill({ status: 405, json: { message: "Fixture is read only" } })
      return
    }
    if (path === "/api/v1/auth/me") {
      await route.fulfill({ json: user })
    } else if (path === "/api/v1/students") {
      await route.fulfill({ json: students })
    } else if (path === "/api/v1/lessons") {
      listRequests++
      await route.fulfill({ json: lessons })
    } else {
      const lesson = lessons.find((item) => path === `/api/v1/lessons/${item.id}`)
      if (lesson) await route.fulfill({ json: lesson })
      else {
        unexpectedRequests.push(`GET ${path}`)
        await route.fulfill({ status: 404, json: { message: "Unknown fixture" } })
      }
    }
  })
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "내 수업", exact: true })).toBeVisible()
  return {
    update(change: (lessons: ApiLesson[]) => ApiLesson[]) {
      lessons = change(lessons)
    },
    async refresh() {
      const before = listRequests
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await expect.poll(() => listRequests).toBeGreaterThan(before)
    },
    expectNoUnexpectedRequests() {
      expect(unexpectedRequests).toEqual([])
    },
  }
}

for (const user of [teacher, students[0]]) {
  test(`${user.role}: choosing a LIVE row changes the feature and its admission target in place`, async ({ page }, testInfo) => {
    const mock = await mockDashboard(page, user)
    const feature = page.locator(".session-feature")
    const quickJoin = page.getByRole("region", { name: "링크로 수업 참여", exact: true })
    await expect(feature.getByRole("heading", { name: "분수 연습", exact: true })).toBeVisible()
    await expect(feature.locator(".session-attendees")).toHaveText(/1명\s*참여 중\s*\/\s*2명/)
    await expect(quickJoin).toBeVisible()
    const originalUrl = page.url()
    await page.getByRole("tab", { name: /^진행 중\s*2$/ }).click()
    const first = page.locator(".dashboard-lesson-row").filter({ hasText: "분수 연습" })
    const second = page.locator(".dashboard-lesson-row").filter({ hasText: "덧셈의 이해" })
    await expect(page.locator(".dashboard-lesson-row")).toHaveCount(2)
    await expect(first).toHaveAttribute("aria-pressed", "true")
    await second.click()
    await expect(page).toHaveURL(originalUrl)
    await expect(second).toHaveAttribute("aria-pressed", "true")
    await expect(second).toHaveClass(/is-selected/)
    await expect(first).toHaveAttribute("aria-pressed", "false")
    await expect(feature.getByRole("heading", { name: "덧셈의 이해", exact: true })).toBeVisible()
    await expect(feature.locator(".session-time")).toContainText("오후 4:00")
    await expect(feature.locator(".session-time")).toContainText("50분")
    await expect(feature.locator(".session-attendees")).toHaveText(/2명\s*참여 중\s*\/\s*3명/)
    await expect(quickJoin.getByPlaceholder("코드 또는 링크 붙여넣기")).toBeVisible()
    const featureBounds = await feature.boundingBox()
    const inviteBounds = await quickJoin.boundingBox()
    expect(featureBounds).not.toBeNull()
    expect(inviteBounds).not.toBeNull()
    expect(inviteBounds!.x).toBeGreaterThan(featureBounds!.x + featureBounds!.width)
    expect(Math.abs(inviteBounds!.y - featureBounds!.y)).toBeLessThan(2)
    if (user.role === "teacher") {
      await page.screenshot({ path: testInfo.outputPath("desktop-selected-live.png") })
    }
    await feature.getByRole("button", { name: user.role === "teacher" ? "수업으로 돌아가기" : "수업 참여", exact: true }).click()
    await expect(page).toHaveURL(/\/lessons\/live-second\/prejoin$/)
    mock.expectNoUnexpectedRequests()
  })
}

test("selected LIVE lesson survives other tabs, detail navigation and refreshed participant data", async ({ page }) => {
  const mock = await mockDashboard(page)
  const feature = page.locator(".session-feature")
  await page.getByRole("tab", { name: /^진행 중/ }).click()
  await page.locator(".dashboard-lesson-row").filter({ hasText: "덧셈의 이해" }).click()
  await page.getByRole("tab", { name: /^예정된 수업/ }).click()
  await page.locator(".dashboard-lesson-row").filter({ hasText: "삼각형의 넓이" }).click()
  await expect(page).toHaveURL(/\/lessons\/upcoming-fixture$/)
  await page.getByRole("button", { name: "이전 화면으로 돌아가기", exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(feature.getByRole("heading", { name: "덧셈의 이해", exact: true })).toBeVisible()
  await expect(page.getByRole("tab", { name: /^예정된 수업/ })).toHaveAttribute("aria-selected", "true")
  await page.getByRole("tab", { name: /^진행 중/ }).click()
  await expect(page.locator(".dashboard-lesson-row").filter({ hasText: "덧셈의 이해" })).toHaveAttribute("aria-pressed", "true")
  mock.update((lessons) => lessons.map((lesson) => lesson.id === "live-second" ? { ...lesson, participants: [{ userId: teacher.id, joinedAt: lesson.startedAt! }] } : lesson))
  await mock.refresh()
  await expect(feature.getByRole("heading", { name: "덧셈의 이해", exact: true })).toBeVisible()
  await expect(feature.locator(".session-attendees")).toHaveText(/0명\s*참여 중\s*\/\s*3명/)
  await page.getByRole("tab", { name: /^지난 수업/ }).click()
  await expect(page.locator(".dashboard-lesson-row")).toHaveCount(1)
  await expect(page.locator(".dashboard-lesson-row")).toContainText("지난 곱셈 수업")
  mock.expectNoUnexpectedRequests()
})

test("ending the selected LIVE lesson falls back to another LIVE lesson, then the idle feature", async ({ page }) => {
  const mock = await mockDashboard(page)
  const feature = page.locator(".session-feature")
  await page.getByRole("tab", { name: /^진행 중/ }).click()
  await page.locator(".dashboard-lesson-row").filter({ hasText: "덧셈의 이해" }).click()
  mock.update((lessons) => lessons.map((lesson) => lesson.id === "live-second" ? { ...lesson, status: "ENDED" } : lesson))
  await mock.refresh()
  await expect(page.getByRole("tab", { name: /^진행 중\s*1$/ })).toHaveAttribute("aria-selected", "true")
  await expect(feature.getByRole("heading", { name: "분수 연습", exact: true })).toBeVisible()
  await expect(page.locator(".dashboard-lesson-row")).toHaveCount(1)
  await expect(page.locator(".dashboard-lesson-row")).toHaveAttribute("aria-pressed", "true")
  mock.update((lessons) => lessons.map((lesson) => lesson.status === "LIVE" ? { ...lesson, status: "ENDED" } : lesson))
  await mock.refresh()
  await expect(page.getByRole("tab", { name: /^진행 중\s*0$/ })).toHaveAttribute("aria-selected", "true")
  await expect(feature.getByRole("heading", { name: "지금 진행 중인 수업이 없어요", exact: true })).toBeVisible()
  await expect(page.locator(".dashboard-lesson-row")).toHaveCount(0)
  await expect(page.locator(".dashboard-empty")).toContainText("진행 중인 수업이 없어요")
  await expect(feature.locator(".session-enter")).toHaveCount(0)
  mock.expectNoUnexpectedRequests()
})


test("mobile LIVE tabs fit and searching any invited student preserves the selected feature", async ({ page }, testInfo) => {
  const mock = await mockDashboard(page)
  const feature = page.locator(".session-feature")
  // The existing product layout has a 360px minimum width (src/index.css).
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 })
    const search = page.getByRole("textbox", { name: "수업 검색", exact: true })
    await search.fill("")
    await page.getByRole("tab", { name: /^진행 중/ }).click()
    for (const tab of await page.getByRole("tab").all()) {
      const bounds = await tab.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1)
    }
    await page.locator(".dashboard-lesson-row").filter({ hasText: "분수 연습" }).click()
    await page.locator(".dashboard-lesson-row").filter({ hasText: "덧셈의 이해" }).click()
    await expect(feature.getByRole("heading", { name: "덧셈의 이해", exact: true })).toBeVisible()
    await search.fill("최하은")
    await expect(page.locator(".dashboard-lesson-row")).toHaveCount(1)
    await expect(page.locator(".dashboard-lesson-row")).toContainText("덧셈의 이해")
    await expect(page.locator(".dashboard-lesson-row")).toHaveAttribute("aria-pressed", "true")
    await expect(feature.getByRole("heading", { name: "덧셈의 이해", exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`mobile-${width}-live-selection.png`), fullPage: true })
  }
  mock.expectNoUnexpectedRequests()
})
