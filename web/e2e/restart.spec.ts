import { test, expect } from "@playwright/test"
import { PDFDocument, rgb } from "pdf-lib"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { createLesson, login, shareTextbook } from "./helpers"
import type { MeetingSnapshot } from "../src/lib/meeting"

// Explicit opt-in: this test intentionally restarts the deployed application.
test.describe("Docker restart acceptance", () => {
  test.skip(process.env.TEST_RESTART !== "1", "Run separately with TEST_RESTART=1 after other acceptance tests finish")
  test.describe.configure({ mode: "serial" })

  test("live lesson, chat, PDF page, annotations and original file survive all application containers restarting", async ({ page, request }) => {
    test.setTimeout(180_000)
    const localDirectory = resolve(process.cwd(), "../infra/local")
    const message = `재시작 영속성 확인 ${Date.now()}`
    const name = `restart-worksheet-${Date.now()}.pdf`
    let lessonId: string | undefined
    let materialId: string | undefined
    try {
      await login(page, "teacher1")
      const lesson = await createLesson(page.request, 1)
      lessonId = lesson.id
      await page.goto(`/lessons/${lessonId}/prejoin`)
      await page.getByRole("button", { name: "화상미팅 입장", exact: true }).click()
      await expect(page.locator(".call-connected")).toHaveText("연결됨")
      await page.getByRole("button", { name: "수업방 모드", exact: true }).click()
      await page.getByRole("dialog", { name: "화면 공유", exact: true }).getByRole("button", { name: "취소", exact: true }).click()
      const meetingUrl = page.url()

      const pdf = await PDFDocument.create()
      for (let i = 1; i <= 2; i++) {
        const sheet = pdf.addPage([600, 400])
        sheet.drawText(`Durable class worksheet ${i}`, { x: 35, y: 320, size: 24, color: rgb(.1, .2, .5) })
      }
      const originalBytes = Buffer.from(await pdf.save())
      const originalHash = createHash("sha256").update(originalBytes).digest("hex")
      const upload = await page.request.post("/api/v1/materials", { multipart: { file: { name, mimeType: "application/pdf", buffer: originalBytes } } })
      expect(upload.ok()).toBeTruthy()
      materialId = (await upload.json()).id
      await page.locator(".call-controls").getByRole("button", { name: "수업 자료", exact: true }).click()
      await shareTextbook(page, materialId!)
      await expect(page.getByLabel(`${name} 1페이지`, { exact: true })).toBeVisible()
      await page.getByRole("button", { name: "PDF 다음 페이지", exact: true }).click()
      await expect(page.getByLabel(`${name} 2페이지`, { exact: true })).toBeVisible()
      await page.getByRole("button", { name: "판서 시작", exact: true }).click()
      const rect = await page.getByLabel("수업 판서 영역", { exact: true }).boundingBox()
      expect(rect).not.toBeNull()
      await page.mouse.move(rect!.x + rect!.width * .2, rect!.y + rect!.height * .3)
      await page.mouse.down()
      await page.mouse.move(rect!.x + rect!.width * .65, rect!.y + rect!.height * .55, { steps: 12 })
      await page.mouse.up()
      await page.locator(".call-controls").getByRole("button", { name: "채팅", exact: true }).click()
      await page.getByLabel("채팅 메시지", { exact: true }).fill(message)
      await page.getByRole("button", { name: "메시지 전송", exact: true }).click()
      await expect.poll(async () => {
        const snapshot = await (await page.request.get(`/api/v1/lessons/${lessonId}/snapshot`)).json() as MeetingSnapshot
        return snapshot.strokes.length > 0 && snapshot.messages.some(item => item.text === message)
      }).toBe(true)
      const before = await (await page.request.get(`/api/v1/lessons/${lessonId}/snapshot`)).json() as MeetingSnapshot
      expect(before.lesson.status).toBe("LIVE")
      expect(before.lesson.startedAt).toBeTruthy()
      expect(before.share?.materialId).toBe(materialId)
      expect(before.share?.page).toBe(2)

      execFileSync("docker", ["compose", "--project-directory", localDirectory, "--file", resolve(localDirectory, "compose.yaml"), "restart", "api", "livekit", "web"], { cwd: localDirectory, timeout: 120_000, stdio: "pipe" })
      await expect.poll(async () => {
        try { return (await request.get("/api/v1/health", { timeout: 2500 })).status() }
        catch { return 0 }
      }, { timeout: 60_000, intervals: [250, 500, 1000] }).toBe(200)

      const persisted = await page.request.get(`/api/v1/lessons/${lessonId}/snapshot`)
      expect(persisted.ok()).toBeTruthy() // The existing login session also survives.
      const afterRestart = await persisted.json() as MeetingSnapshot
      expect(afterRestart.lesson.id).toBe(before.lesson.id)
      expect(afterRestart.lesson.status).toBe("LIVE")
      expect(afterRestart.lesson.startedAt).toBe(before.lesson.startedAt)
      expect(afterRestart.messages).toEqual(before.messages)
      expect(afterRestart.share).toEqual(before.share)
      expect(afterRestart.strokes).toEqual(before.strokes)
      const file = await page.request.get(`/api/v1/materials/${materialId}/content`)
      expect(file.ok()).toBeTruthy()
      expect(createHash("sha256").update(await file.body()).digest("hex")).toBe(originalHash)

      const rejoin = await page.request.post(`/api/v1/lessons/${lessonId}/join`)
      expect(rejoin.ok()).toBeTruthy()
      const admission = await rejoin.json()
      expect(admission.waiting).toBe(false)
      expect(typeof admission.token).toBe("string")
      // Load the original meeting URL again: the new API admission recreates
      // the missing LiveKit room, then the actual browser rejoins that room.
      await page.goto(meetingUrl)
      await expect(page.locator(".call-connected")).toHaveText("연결됨")
      await expect(page.getByLabel(`${name} 2페이지`, { exact: true })).toBeVisible()
      await expect(page.locator(".live-annotation path")).toHaveCount(before.strokes.filter(item => !item.deleted && item.page === 2).length)
      await page.locator(".call-controls").getByRole("button", { name: "채팅", exact: true }).click()
      await expect(page.locator(".messages")).toContainText(message)
      const finalSnapshot = await (await page.request.get(`/api/v1/lessons/${lessonId}/snapshot`)).json() as MeetingSnapshot
      expect(finalSnapshot.lesson.startedAt).toBe(before.lesson.startedAt)
      expect(finalSnapshot.share?.id).toBe(before.share?.id)
      expect(finalSnapshot.strokes).toEqual(before.strokes)
    } finally {
      if (lessonId) await page.request.post(`/api/v1/lessons/${lessonId}/end`).catch(() => {})
      if (materialId) await page.request.delete(`/api/v1/materials/${materialId}`).catch(() => {})
    }
  })
})
