import { expect, test } from "@playwright/test"
import { login } from "./helpers"

test("a teacher can retry the subject list, save a subject, and clear it", async ({ page }) => {
  await login(page, "teacher1")
  await page.route("**/api/v1/subjects", route => route.fulfill({ status: 503 }), { times: 1 })
  await page.getByRole("button", { name: "새 수업 예약", exact: true }).click()

  const title = `과목 선택 검증 ${Date.now()}`
  const subject = page.getByLabel("과목 (선택)", { exact: true })
  const reserve = page.getByRole("main").getByRole("button", { name: "수업 예약", exact: true })
  await page.getByLabel("학습 제목").fill(title)
  await expect(page.getByText("과목을 불러오지 못했어요.")).toBeVisible()
  await expect(subject).toBeDisabled()
  await expect(reserve).toBeEnabled()
  await page.getByRole("button", { name: "다시 불러오기", exact: true }).click()
  await expect(subject).toBeEnabled()
  await expect(page.getByLabel("학습 제목")).toHaveValue(title)
  await subject.selectOption({ label: "바로셈" })
  await page.locator(".student-options button").filter({ hasText: "김민준" }).click()
  await reserve.click()
  await expect(page.getByRole("heading", { name: "수업 일정이 저장되었어요" })).toBeVisible()
  const lessonId = new URL(page.url()).pathname.split("/")[2]

  try {
    await page.goto("/")
    const row = page.getByRole("button").filter({ hasText: title })
    await expect(row.getByText("바로셈", { exact: true })).toBeVisible()
    await row.click()
    await expect(page.getByText("바로셈", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "일정 수정", exact: true }).click()
    await expect(subject.locator("option:checked")).toHaveText("바로셈")
    await subject.selectOption({ label: "선택 안 함" })
    await page.getByRole("button", { name: "변경사항 저장", exact: true }).click()
    await page.getByRole("button", { name: "일정 보기", exact: true }).click()
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible()
    await expect(page.getByText("과목", { exact: true })).toHaveCount(0)
  } finally {
    await page.request.post(`/api/v1/lessons/${lessonId}/cancel`)
  }
})
