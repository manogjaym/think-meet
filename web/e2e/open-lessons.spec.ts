import { expect, test, type Page } from "@playwright/test"
import type { ApiLesson, User } from "../src/lib/api"

// Account, roster, and lesson requests are intercepted; this suite edits no live data.
// Run against local source with BASE_URL=http://127.0.0.1:8443.
const teacher: User = {
  id: "open-lesson-teacher",
  username: "teacher-fixture",
  name: "윤지아",
  role: "teacher",
}
const students: User[] = [
  {
    id: "open-student-1",
    username: "student1",
    name: "김민준",
    role: "student",
  },
  {
    id: "open-student-2",
    username: "student2",
    name: "이서윤",
    role: "student",
  },
]
type Reservation = {
  title: string
  description: string
  startsAt: string
  endsAt: string | null
  accessMode: "INVITE_ONLY" | "OPEN"
  studentIds: string[]
}

function lessonFixture(): ApiLesson {
  const day = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const startsAt = new Date(`${day}T07:00:00.000Z`)
  return {
    id: "open-lesson-fixture",
    title: "함께 배우는 수학",
    description: "누구나 함께할 수 있는 수업",
    teacher,
    students: [],
    accessMode: "OPEN",
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 50 * 60000).toISOString(),
    status: "SCHEDULED",
    code: "open-fixture-code",
    startedAt: null,
    endedAt: null,
    participants: [],
    attendance: [],
  }
}

async function mockReservations(
  page: Page,
  initial: ApiLesson[] = [],
  user = teacher,
) {
  const lessons = new Map(initial.map((lesson) => [lesson.id, lesson]))
  const writes: {
    method: string
    payload: Reservation
  }[] = []
  const unexpectedRequests: string[] = []
  await page.route("**/socket.io/**", (route) => route.abort())
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    if (method === "GET" && path === "/api/v1/auth/me") {
      await route.fulfill({ json: user })
      return
    }
    if (method === "GET" && path === "/api/v1/students") {
      await route.fulfill({ json: students })
      return
    }
    if (method === "GET" && path === "/api/v1/lessons") {
      await route.fulfill({ json: [...lessons.values()] })
      return
    }
    const id = path.match(/^\/api\/v1\/lessons\/([^/]+)$/)?.[1]
    if (method === "GET" && id && lessons.has(id)) {
      await route.fulfill({ json: lessons.get(id) })
      return
    }
    if (
      (method === "POST" && path === "/api/v1/lessons") ||
      (method === "PATCH" && id && lessons.has(id))
    ) {
      const payload = request.postDataJSON() as Reservation
      writes.push({ method, payload })
      const lesson = {
        ...(id ? lessons.get(id)! : lessonFixture()),
        ...payload,
        students: students.filter((student) =>
          payload.studentIds.includes(student.id),
        ),
      }
      lessons.set(lesson.id, lesson)
      await route.fulfill({ json: lesson })
      return
    }
    unexpectedRequests.push(`${method} ${path}`)
    await route.fulfill({
      status: 404,
      json: { message: "Unknown fixture request" },
    })
  })
  return {
    writes,
    expectNoUnexpectedRequests() {
      expect(unexpectedRequests).toEqual([])
    },
  }
}

async function openNewForm(page: Page) {
  await page.goto("/lessons/new")
  await expect(
    page.getByRole("heading", { name: "새 수업 예약", exact: true }),
  ).toBeVisible()
  await page.getByLabel("학습 제목").fill("열린 수학 교실")
  await page
    .getByLabel("날짜")
    .fill(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))
  await page.getByLabel("시작 시간").fill("16:00")
  await page.getByLabel("종료 시간", { exact: true }).fill("16:50")
}

function submit(page: Page, name = "수업 예약") {
  return page
    .getByRole("main")
    .getByRole("button", { name, exact: true })
    .click()
}

test("invitation mode remains the default and requires a selected student", async ({
  page,
}) => {
  const mock = await mockReservations(page)
  await openNewForm(page)
  await expect(
    page.getByRole("radio", { name: "선택한 학생만", exact: true }),
  ).toBeChecked()
  await submit(page)
  await expect(
    page.getByText("학생을 한 명 이상 선택해 주세요.", { exact: true }),
  ).toBeVisible()
  expect(mock.writes).toEqual([])
  await page
    .locator(".student-options button")
    .filter({ hasText: "김민준" })
    .click()
  await submit(page)
  await expect(
    page.getByRole("heading", { name: "수업 일정이 저장되었어요" }),
  ).toBeVisible()
  expect(mock.writes).toHaveLength(1)
  expect(mock.writes[0]).toMatchObject({
    method: "POST",
    payload: { accessMode: "INVITE_ONLY", studentIds: [students[0].id] },
  })
  mock.expectNoUnexpectedRequests()
})

test("an open lesson can be created without students and retains its mode after refresh", async ({
  page,
}) => {
  const mock = await mockReservations(page)
  await openNewForm(page)
  await page.getByRole("radio", { name: "누구나 참여", exact: true }).check()
  await expect(page.getByLabel("학생 이름 검색", { exact: true })).toHaveCount(
    0,
  )
  await expect(
    page.getByText("학생을 한 명 이상 선택해 주세요.", { exact: true }),
  ).toHaveCount(0)
  await page.getByLabel("종료 시간 없음", { exact: true }).check()
  await submit(page)
  await expect(
    page.getByRole("heading", { name: "수업 일정이 저장되었어요" }),
  ).toBeVisible()
  expect(mock.writes).toHaveLength(1)
  expect(mock.writes[0]).toMatchObject({
    method: "POST",
    payload: { accessMode: "OPEN", studentIds: [], endsAt: null },
  })
  await expect(page.locator(".success-card")).not.toContainText(
    "학생을 수업에 초대했어요",
  )
  await page.reload()
  await expect(page.locator(".success-card")).toContainText("공개 수업")
  await page.getByRole("button", { name: "일정 보기", exact: true }).click()
  await expect(page.locator(".detail-main")).toContainText("누구나 참여")
  await expect(page.locator(".detail-main")).not.toContainText("초대 학생 없음")
  mock.expectNoUnexpectedRequests()
})

test("switching participation modes preserves picks but never submits hidden invitations", async ({
  page,
}) => {
  const mock = await mockReservations(page)
  await openNewForm(page)
  const picked = page
    .locator(".student-options button")
    .filter({ hasText: "이서윤" })
  await picked.click()
  await expect(picked).toHaveAttribute("aria-pressed", "true")
  const inviteMode = page.getByRole("radio", { name: "선택한 학생만", exact: true })
  const openMode = page.getByRole("radio", { name: "누구나 참여", exact: true })
  await inviteMode.focus()
  await page.keyboard.press("ArrowRight")
  await expect(openMode).toBeChecked()
  await page.keyboard.press("ArrowLeft")
  await expect(inviteMode).toBeChecked()
  await openMode.check()
  await page.getByRole("radio", { name: "선택한 학생만", exact: true }).check()
  await expect(picked).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("radio", { name: "누구나 참여", exact: true }).check()
  await submit(page)
  await expect(
    page.getByRole("heading", { name: "수업 일정이 저장되었어요" }),
  ).toBeVisible()
  expect(mock.writes).toHaveLength(1)
  expect(mock.writes[0].payload).toMatchObject({
    accessMode: "OPEN",
    studentIds: [],
  })
  mock.expectNoUnexpectedRequests()
})

test("editing restores public mode and persists conversion in both directions", async ({
  page,
}) => {
  const lesson = lessonFixture()
  const mock = await mockReservations(page, [lesson])
  await page.goto(`/lessons/${lesson.id}/edit`)
  await expect(
    page.getByRole("heading", { name: "수업 일정 수정", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("radio", { name: "누구나 참여", exact: true }),
  ).toBeChecked()
  await page.getByRole("radio", { name: "선택한 학생만", exact: true }).check()
  await submit(page, "변경사항 저장")
  await expect(
    page.getByText("학생을 한 명 이상 선택해 주세요.", { exact: true }),
  ).toBeVisible()
  expect(mock.writes).toEqual([])
  await page
    .locator(".student-options button")
    .filter({ hasText: "김민준" })
    .click()
  await submit(page, "변경사항 저장")
  await expect(
    page.getByRole("heading", { name: "수업 일정이 저장되었어요" }),
  ).toBeVisible()
  expect(mock.writes[0]).toMatchObject({
    method: "PATCH",
    payload: { accessMode: "INVITE_ONLY", studentIds: [students[0].id] },
  })
  await page.goto(`/lessons/${lesson.id}/edit`)
  await expect(
    page.getByRole("radio", { name: "선택한 학생만", exact: true }),
  ).toBeChecked()
  await expect(
    page.locator(".student-options button").filter({ hasText: "김민준" }),
  ).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("radio", { name: "누구나 참여", exact: true }).check()
  await submit(page, "변경사항 저장")
  await expect(
    page.getByRole("heading", { name: "수업 일정이 저장되었어요" }),
  ).toBeVisible()
  expect(mock.writes[1]).toMatchObject({
    method: "PATCH",
    payload: { accessMode: "OPEN", studentIds: [] },
  })
  await page.goto(`/lessons/${lesson.id}/edit`)
  await expect(
    page.getByRole("radio", { name: "누구나 참여", exact: true }),
  ).toBeChecked()
  mock.expectNoUnexpectedRequests()
})

test("participation choices and form stay within desktop and mobile layouts", async ({
  page,
}, testInfo) => {
  const mock = await mockReservations(page)
  await openNewForm(page)
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const mode of ["선택한 학생만", "누구나 참여"]) {
      await page.getByRole("radio", { name: mode, exact: true }).check()
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true)
      for (const radio of await page.getByRole("radio").all()) {
        await expect(radio).toBeVisible()
      }
      if (width === 1440 || width === 390) {
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        await page.screenshot({
          path: testInfo.outputPath(
            `${width}-${mode === "누구나 참여" ? "open" : "invite"}.png`,
          ),
          fullPage: true,
        })
        if (width === 390 && mode === "누구나 참여") {
          await page.locator(".students-select").evaluate((element) => {
            window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 84, behavior: "instant" })
          })
          await page.screenshot({ path: testInfo.outputPath("390-open-viewport.png") })
        }
      }
    }
  }
  expect(mock.writes).toEqual([])
  mock.expectNoUnexpectedRequests()
})

test("another teacher can discover an open lesson without receiving host controls", async ({
  page,
}) => {
  const lesson = lessonFixture()
  const visitor = {
    ...teacher,
    id: "visiting-teacher",
    username: "visitor",
    name: "방문 교사",
  }
  const mock = await mockReservations(page, [lesson], visitor)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  const row = page
    .locator(".dashboard-lesson-row")
    .filter({ hasText: lesson.title })
  await expect(row).toBeVisible()
  await expect(row).toContainText("공개 수업")
  await row.click()
  await expect(
    page.getByRole("heading", { name: lesson.title, exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "일정 수정", exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "예정 수업 취소", exact: true }),
  ).toHaveCount(0)
  await page.getByRole("button", { name: "입장 준비", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "지금 참여하기", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "수업 시작하기", exact: true }),
  ).toHaveCount(0)
  expect(mock.writes).toEqual([])
  mock.expectNoUnexpectedRequests()
})
