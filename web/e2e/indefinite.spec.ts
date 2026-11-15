import { test, expect } from "@playwright/test"
import { displayLesson, type ApiLesson } from "../src/lib/api"
import { login } from "./helpers"

test("an indefinite lesson retains its missing end time and a useful display label", () => {
  const user = { id: "teacher", username: "teacher1", name: "윤지아", role: "teacher" as const }
  const lesson: ApiLesson = {
    id: "indefinite", title: "무제한 수업", description: "", teacher: user, students: [],
    startsAt: "2026-11-07T01:00:00.000Z", endsAt: null,
    status: "LIVE", code: "unlimited", startedAt: "2026-11-07T01:00:00.000Z", endedAt: null,
  }
  const display = displayLesson(lesson)
  expect(display.endsAt).toBeNull()
  expect(display.endTime).toBe("")
  expect(display.duration).toBe("종료 시간 없음")
  expect(display.startTime).toBe("10:00")
  const finite = displayLesson({ ...lesson, endsAt: "2026-11-07T01:50:00.000Z" })
  expect(finite.duration).toBe("50분")
  expect(finite.endTime).toBe("10:50")
})

test("an indefinite reservation stays indefinite after editing and refresh", async ({ page }) => {
  await login(page, "teacher1")
  await page.goto("/lessons/new")
  await page.getByLabel("학습 제목").fill(`종료 시간 없음 검증 ${Date.now()}`)
  await page.getByLabel("날짜").fill(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))
  await page.getByLabel("시작 시간").fill("16:00")
  await page.getByLabel("종료 시간 없음", { exact: true }).check()
  await expect(page.getByLabel("종료 시간", { exact: true })).toBeDisabled()
  await page.locator(".student-options button").filter({ hasText: "김민준" }).click()
  let id: string | undefined
  try {
    await page.getByRole("main").getByRole("button", { name: "수업 예약", exact: true }).click()
    await expect(page.getByRole("heading", { name: "수업 일정이 저장되었어요" })).toBeVisible()
    id = new URL(page.url()).pathname.split("/")[2]
    expect((await (await page.request.get(`/api/v1/lessons/${id}`)).json()).endsAt).toBeNull()
    await page.getByRole("button", { name: "일정 보기", exact: true }).click()
    await expect(page.locator(".info-grid")).toContainText("종료 시간 없음")
    await page.getByRole("button", { name: "일정 수정", exact: true }).click()
    await expect(page.getByLabel("종료 시간 없음", { exact: true })).toBeChecked()
    await page.getByLabel("학습 제목").fill(`종료 시간 없음 검증 수정 ${Date.now()}`)
    await page.getByRole("button", { name: "변경사항 저장", exact: true }).click()
    await expect(page.getByRole("heading", { name: "수업 일정이 저장되었어요" })).toBeVisible()
    await page.reload()
    await expect(page.locator(".created-summary")).toContainText("종료 시간 없음")
    expect((await (await page.request.get(`/api/v1/lessons/${id}`)).json()).endsAt).toBeNull()
  } finally {
    if (id) await page.request.post(`/api/v1/lessons/${id}/cancel`)
  }
})
