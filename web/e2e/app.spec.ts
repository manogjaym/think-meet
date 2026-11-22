import { test, expect, type Page } from "@playwright/test"
import { login, password } from "./helpers"
import { createWaitingAdmission } from "../src/lib/waitingAdmission"
import { designContent } from "../src/generated/design-content"
async function createLesson(page: Page, title: string) {
  await page.getByRole("button", { name: "새 수업 예약", exact: true }).click()
  await page.getByLabel("학습 제목").fill(title)
  const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  await page.getByLabel("날짜").fill(future)
  await page.getByLabel("시작 시간").fill("16:00")
  await page.getByLabel("종료 시간", { exact: true }).fill("16:50")
  await page.locator(".student-options button").filter({ hasText: "김민준" }).click()
  await page.getByRole("main").getByRole("button", { name: "수업 예약", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "수업 일정이 저장되었어요" }),
  ).toBeVisible()
  return new URL(page.url()).pathname.split("/")[2]
}
test("real login, reservation edit, persistence and cancellation", async ({
  page,
}) => {
  await login(page, "teacher1")
  const title = `자동 검증 수업 ${Date.now()}`
  const id = await createLesson(page, title)
  await page.getByRole("button", { name: "일정 보기", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "일정 수정", exact: true }).click()
  await page.getByLabel("학습 제목").fill(`${title} 수정`)
  await page.getByRole("button", { name: "변경사항 저장", exact: true }).click()
  await page.getByRole("button", { name: "일정 보기", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: `${title} 수정`, exact: true }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "예정 수업 취소", exact: true })
    .click()
  await page.getByRole("button", { name: "수업 취소", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "내 수업", exact: true }),
  ).toBeVisible()
  await page.goto(`/lessons/${id}`)
  await expect(
    page.getByRole("heading", { name: "취소된 수업이에요" }),
  ).toBeVisible()
})
test("invitation deep link retains destination through login and student waits", async ({
  page,
  browser,
  baseURL,
}) => {
  await login(page, "teacher1")
  const id = await createLesson(page, `입장 대기 검증 ${Date.now()}`)
  const detail = await page.request.get(`/api/v1/lessons/${id}`)
  expect(detail.ok()).toBeTruthy()
  const lesson = (await detail.json()) as {
    code: string
    students: { username: string }[]
  }
  const context = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    permissions: ["camera", "microphone"],
  })
  try {
    const student = await context.newPage()
    await student.goto(`/join/${lesson.code}`)
    await expect(student).toHaveURL(/\/login\?next=/)
    await student
      .getByLabel("아이디", { exact: true })
      .fill(lesson.students[0].username)
    await student.getByLabel("비밀번호", { exact: true }).fill(password)
    await student.getByRole("button", { name: "로그인", exact: true }).click()
    await expect(student).toHaveURL(new RegExp(`/lessons/${id}/prejoin`))
    // With the prejoin check, a student waits for a scheduled lesson instead of joining directly.
    await student
      .getByRole("button", { name: designContent.prejoinWaitAction, exact: true })
      .click()
    await expect(student).toHaveURL(new RegExp(`/lessons/${id}/waiting`))
    await expect(
      student.getByRole("heading", { name: "곧 수업이 시작돼요" }),
    ).toBeVisible()
    await student.reload()
    await expect(
      student.getByRole("heading", { name: "곧 수업이 시작돼요" }),
    ).toBeVisible()
  } finally {
    await context.close()
    await page.request.post(`/api/v1/lessons/${id}/cancel`)
  }
})
test("invalid and uninvited links show actual server errors", async ({
  page,
  browser,
  baseURL,
}) => {
  await login(page, "teacher1")
  await page.goto("/join/invalid-code-for-e2e")
  await expect(
    page.getByRole("heading", { name: "수업을 찾을 수 없어요" }),
  ).toBeVisible()
  await page.goto("/")
  const id = await createLesson(page, `초대 권한 검증 ${Date.now()}`)
  const lesson = (await (
    await page.request.get(`/api/v1/lessons/${id}`)
  ).json()) as {
    code: string
    students: { username: string }[]
  }
  const invited = new Set(lesson.students.map((student) => student.username))
  const other = ["student1", "student2", "student3", "student4"].find(
    (name) => !invited.has(name),
  )!
  const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true })
  try {
    const student = await context.newPage()
    await login(student, other)
    await student.goto(`/join/${lesson.code}`)
    await expect(
      student.getByRole("heading", { name: "초대된 계정이 아니에요" }),
    ).toBeVisible()
  } finally {
    await context.close()
    await page.request.post(`/api/v1/lessons/${id}/cancel`)
  }
})


test("repeated LIVE notifications mint one admission before React navigation cleanup", async () => {
  let calls = 0, admitted = 0
  let complete!: (result: { waiting: boolean }) => void
  const response = new Promise<{ waiting: boolean }>(resolve => { complete = resolve })
  const gate = createWaitingAdmission(async () => { calls++; return response }, () => { admitted++; void gate.request() }, error => { throw error })
  const first = gate.request()
  await Promise.all([gate.request(), gate.request()])
  expect(calls).toBe(1)
  complete({ waiting: false })
  await first
  // A socket callback can run after navigation was requested and before cleanup.
  await Promise.all([gate.request(), gate.request()])
  expect(calls).toBe(1)
  expect(admitted).toBe(1)
  gate.dispose()
})
test("waiting admission retries transient failures and ignores an unmounted view", async () => {
  let calls = 0, admitted = 0, errors = 0
  const gate = createWaitingAdmission(async () => {
    calls++
    if(calls === 1) throw new Error("Temporary connection failure")
    return {waiting: calls === 2}
  }, () => { admitted++ }, () => { errors++ })
  await gate.request()
  await gate.request()
  await gate.request()
  await gate.request()
  expect({calls, admitted, errors}).toEqual({calls: 3, admitted: 1, errors: 1})
  let resolve!: (result: {waiting:boolean}) => void
  const pending = new Promise<{waiting:boolean}>(done => {resolve=done})
  const disposed = createWaitingAdmission(() => pending, () => {admitted++}, () => {})
  const request=disposed.request(); disposed.dispose(); resolve({waiting:false}); await request
  expect(admitted).toBe(1)
})
