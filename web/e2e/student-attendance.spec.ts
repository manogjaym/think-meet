import { expect, test } from "@playwright/test"
import { CONTRACT_REVISION, type StudentAttendanceInput, type StudentAttendanceMonth } from "../src/generated/contracts"
import { koreaParts } from "../src/lib/api"

const teacher = { id: "0b791a6c-9fdb-4eec-8a70-92a031e00644", username: "teacher", name: "윤지아", role: "teacher" }
const student = { id: "27029286-51c6-4a6f-8b91-9d9ceeb493d7", username: "student", name: "박서준", role: "student" }
const lessonId = "b5e648e8-c887-478d-a214-9fef62bb0c58"
const month = koreaParts(new Date().toISOString()).dateISO.slice(0, 7)

for (const viewport of [{ width: 393, height: 852 }, { width: 1024, height: 768 }]) {
  test(`teacher manages monthly attendance at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    let attempt = 0
    let report: StudentAttendanceMonth = {
      student: { id: student.id, name: student.name },
      month, summary: { rate: 100, present: 1, late: 0, absent: 0 },
      rows: [{
        lessonId, lessonTitle: "바로셈 계산 연습", startsAt: `${month}-10T16:00:00+09:00`,
        firstJoinedAt: `${month}-10T16:02:00+09:00`, lastLeftAt: `${month}-10T16:45:00+09:00`,
        durationSeconds: 36 * 60, status: "PRESENT", reason: null, memo: null,
      }],
    }
    await page.route("**/api/v1/**", async route => {
      const url = new URL(route.request().url())
      const path = url.pathname.replace("/api/v1", "")
      if (path === "/capabilities") return route.fulfill({ json: {
        contractRevision: CONTRACT_REVISION, features: { "classroom.core": true, "classroom.attendance": true },
      } })
      if (path === "/auth/me") return route.fulfill({ json: teacher })
      if (path === "/students") return route.fulfill({ json: [student] })
      if (path === "/lessons") return route.fulfill({ json: [] })
      if (path === `/students/${student.id}/attendance`) {
        const requested = url.searchParams.get("month")
        return route.fulfill({ json: requested === month ? report : {
          ...report, month: requested, rows: [], summary: { rate: null, present: 0, late: 0, absent: 0 },
        } })
      }
      if (path === `/students/${student.id}/attendance/${lessonId}` && route.request().method() === "PUT") {
        const input = route.request().postDataJSON() as StudentAttendanceInput
        expect(input).toEqual({ status: "LATE", reason: "DEVICE", memo: "카메라 확인" })
        if (++attempt === 1) return route.fulfill({ status: 503, json: { message: "잠시 후 다시 시도해 주세요." } })
        report = { ...report, rows: [{ ...report.rows[0], ...input, reason: input.reason ?? null, memo: input.memo ?? null }],
          summary: { rate: 0, present: 0, late: 1, absent: 0 } }
        return route.fulfill({ json: report })
      }
      await route.fulfill({ status: 404, json: {} })
    })

    await page.goto("/")
    await page.getByRole("button", { name: "학생 관리", exact: true }).click()
    await page.getByRole("link", { name: "박서준" }).click()
    await expect(page.getByRole("heading", { name: "출결", exact: true })).toBeVisible()
    await expect(page.getByText("100%", { exact: true })).toBeVisible()
    await expect(page.getByText("36분")).toBeVisible()
    await page.getByRole("button", { name: "이전 달" }).click()
    await expect(page.getByText("이 달의 출결 기록이 없어요.")).toBeVisible()
    await page.getByRole("button", { name: "다음 달" }).click()
    const edit = page.getByRole("button", { name: "바로셈 계산 연습 출결 수정" })
    await edit.click()
    const dialog = page.getByRole("dialog", { name: "출결 수정" })
    await expect(dialog.getByRole("radio", { name: "출석" })).toBeChecked()
    await dialog.getByText("지각", { exact: true }).click()
    await dialog.getByRole("button", { name: "기기 문제" }).click()
    await dialog.getByRole("textbox", { name: "메모" }).fill("카메라 확인")
    await dialog.getByRole("button", { name: "저장", exact: true }).click()
    await expect(dialog.getByRole("alert")).toHaveText("잠시 후 다시 시도해 주세요.")
    await expect(dialog.getByRole("textbox", { name: "메모" })).toHaveValue("카메라 확인")
    await dialog.getByRole("button", { name: "저장", exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText("0%", { exact: true })).toBeVisible()
    await expect(edit).toBeFocused()
    await page.reload()
    await edit.click()
    await expect(dialog.getByRole("radio", { name: "지각" })).toBeChecked()
    await expect(dialog.getByRole("button", { name: "기기 문제" })).toHaveAttribute("aria-pressed", "true")
    await expect(dialog.getByRole("textbox", { name: "메모" })).toHaveValue("카메라 확인")
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
  })
}
