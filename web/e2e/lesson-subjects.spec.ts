import { expect, test } from "@playwright/test"
import { login } from "./helpers"

test("a teacher can retry the subject list, save a subject, and clear it", async ({ page }) => {
  await login(page, "teacher1")
  await page.route("**/api/v1/subjects", route => route.fulfill({ status: 503 }), { times: 1 })
  await page.getByRole("button", { name: "새 수업 예약", exact: true }).click()

  const title = `과목 선택 검증 ${Date.now()}`
  const subject = page.getByRole("button", { name: "과목 선택", exact: true })
  const picker = page.getByRole("dialog", { name: "과목 선택" })
  const reserve = page.getByRole("main").getByRole("button", { name: "수업 예약", exact: true })
  await page.getByLabel("학습 제목").fill(title)
  await subject.click()
  await expect(picker.getByText("과목을 불러오지 못했어요.")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(picker).toHaveCount(0)
  await expect(subject).toBeFocused()
  await expect(reserve).toBeEnabled()
  await subject.click()
  await picker.getByRole("button", { name: "다시 불러오기", exact: true }).click()
  await expect(picker.getByRole("button", { name: "수업 시작", exact: true })).toHaveCount(0)
  await picker.getByRole("button", { name: /바로셈/ }).click()
  await expect(picker).toHaveCount(0)
  await expect(subject).toContainText("바로셈")
  await expect(page.getByLabel("학습 제목")).toHaveValue(title)
  await page.locator(".student-options button").filter({ hasText: "김민준" }).click()
  await reserve.click()
  await expect(page.getByRole("heading", { name: "수업 일정이 저장되었어요" })).toBeVisible()
  const lessonId = new URL(page.url()).pathname.split("/")[2]

  try {
    await page.goto("/")
    const row = page.getByRole("button").filter({ hasText: title })
    await expect(row.getByText("바로셈", { exact: true })).toBeVisible()
    await row.click()
    await expect(page.locator(".detail-main").getByText("바로셈", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "일정 수정", exact: true }).click()
    await expect(subject).toContainText("바로셈")
    await subject.click()
    await expect(picker.getByRole("button", { name: /바로셈/ })).toHaveAttribute("aria-pressed", "true")
    await picker.getByRole("button", { name: "선택 안 함", exact: true }).click()
    await page.getByRole("button", { name: "변경사항 저장", exact: true }).click()
    await page.getByRole("button", { name: "일정 보기", exact: true }).click()
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible()
    await expect(page.getByText("과목", { exact: true })).toHaveCount(0)
  } finally {
    await page.request.post(`/api/v1/lessons/${lessonId}/cancel`)
  }
})

test("the chosen subject retains its record after a lesson starts and ends", async ({ page }) => {
  await login(page, "teacher1")
  await page.goto("/lessons/new")
  const title = `과목 완료 검증 ${Date.now()}`
  const picker = page.getByRole("dialog", { name: "과목 선택" })
  const openPicker = page.getByRole("button", { name: "과목 선택", exact: true })
  await page.getByLabel("학습 제목").fill(title)
  await openPicker.click()
  await picker.getByRole("button", { name: /바로셈/ }).click()
  await page.locator(".student-options button").filter({ hasText: "김민준" }).click()
  await page.getByRole("main").getByRole("button", { name: "수업 예약", exact: true }).click()
  await expect(page.getByRole("heading", { name: "수업 일정이 저장되었어요" })).toBeVisible()
  const lessonId = new URL(page.url()).pathname.split("/")[2]

  try {
    await page.goto(`/lessons/${lessonId}/prejoin`)
    await page.getByRole("button", { name: "화상미팅 입장", exact: true }).click()
    await expect(page.locator(".call-connected")).toHaveText("연결됨")
    await expect(page.locator(".meeting-subtitle")).toContainText("바로셈")
    const start = page.getByRole("group", { name: "수업 모드", exact: true })
      .getByRole("button", { name: /^(수업 시작|수업방 모드)$/ })
    await expect(start).toBeEnabled()
    const opensShare = (await start.textContent())?.trim() === "수업방 모드"
    await start.click()
    if (opensShare) {
      await page.getByRole("dialog", { name: "화면 공유", exact: true }).getByRole("button", { name: "취소", exact: true }).click()
    }
    await expect(page.locator(".meeting-timer")).toBeVisible()
    await page.getByRole("button", { name: "수업 종료", exact: true }).click()
    await page.getByRole("button", { name: "모두 종료", exact: true }).click()
    await expect(page.getByRole("heading", { name: "수업이 모두 종료되었어요" })).toBeVisible()
    await expect(page.locator(".ended-summary")).toContainText("바로셈")
    await page.goto(`/lessons/${lessonId}`)
    await expect(page.getByText("실제 진행 시간", { exact: true })).toBeVisible()
    await page.goto("/lessons/new")
    await openPicker.click()
    await expect(picker.getByRole("button", { name: /바로셈/ })).toContainText(title)
  } finally {
    await page.request.post(`/api/v1/lessons/${lessonId}/end`, { timeout: 5_000 }).catch(() => undefined)
    await page.request.post(`/api/v1/lessons/${lessonId}/cancel`, { timeout: 5_000 }).catch(() => undefined)
  }
})
