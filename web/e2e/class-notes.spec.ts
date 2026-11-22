import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import { PDFDocument, rgb } from "pdf-lib"
import { io } from "socket.io-client"
import { apiLogin, login, openMaterials, shareTextbook, startAnnotation } from "./helpers"
import { currentNoteMonth } from "../src/lib/classNotes"

const headers = { "X-ThinkMeet-Platform": "web", "X-ThinkMeet-Contract-Revision": "6" }
const notes = "/api/v1/class-notes"
const workbook = { name: "학습지.png", mimeType: "image/png", buffer: Buffer.alloc(0) }

async function worksheet(page: Page, color: string) {
  const base64 = await page.evaluate(color => {
    const canvas = document.createElement("canvas")
    canvas.width = 480; canvas.height = 340
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = "#17416c"; ctx.font = "24px sans-serif"; ctx.fillText("Think Meet · Worksheet", 28, 58)
    ctx.font = "18px sans-serif"
    for (let index = 0; index < 5; index++) ctx.fillText(`${index + 1}.   ${index + 3} + 5 = _____`, 32, 110 + index * 40)
    ctx.fillStyle = color; ctx.fillRect(280, 108, 110, 4)
    return canvas.toDataURL("image/png").split(",")[1]
  }, color)
  return { ...workbook, buffer: Buffer.from(base64, "base64") }
}

async function target(request: APIRequestContext) {
  const response = await request.get(`${notes}/target`, { headers })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).lesson
}

async function upload(request: APIRequestContext, path: string, file: typeof workbook, requestId = randomUUID(), extra = {}) {
  return request.post(`${notes}${path}`, { headers, multipart: { file, requestId, ...extra } })
}

async function enter(page: Page, id: string, teacher = false) {
  await page.goto(`/lessons/${id}/prejoin`)
  await page.getByRole("button", { name: teacher ? "화상미팅 입장" : "지금 참여하기", exact: true }).click()
  await expect(page.locator(".call-connected")).toHaveText("연결됨")
  if (teacher) {
    await page.getByRole("button", { name: "수업방 모드", exact: true }).click()
    await page.getByRole("dialog", { name: "화면 공유", exact: true }).getByRole("button", { name: "취소", exact: true }).click()
  }
}

async function drawRedStroke(page: Page) {
  await startAnnotation(page)
  const area = await page.getByLabel("수업 판서 영역", { exact: true }).boundingBox()
  expect(area).toBeTruthy()
  await page.mouse.move(area!.x + area!.width * .2, area!.y + area!.height * .5)
  await page.mouse.down()
  await page.mouse.move(area!.x + area!.width * .65, area!.y + area!.height * .5, { steps: 10 })
  await page.mouse.up()
}

async function checkComposite(page: Page, background: "green" | "blue", savedImage: string) {
  const preview = page.getByRole("img", { name: "저장할 수업 화면", exact: true })
  await expect(preview).toBeVisible()
  await page.screenshot({ path: savedImage, animations: "disabled" })
  const pixels = await preview.evaluate(async (image: HTMLImageElement) => {
    await image.decode()
    const canvas = document.createElement("canvas")
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext("2d")!
    context.drawImage(image, 0, 0)
    const background = Array.from(context.getImageData(canvas.width * .85, canvas.height * .8, 1, 1).data)
    const strip = context.getImageData(canvas.width * .4, canvas.height * .5 - 4, 1, 9).data
    const samples = Array.from({ length: 9 }, (_, index) => Array.from(strip.slice(index * 4, index * 4 + 4)))
    const stroke = samples.reduce((best, pixel) => pixel[0] - pixel[1] > best[0] - best[1] ? pixel : best)
    return { background, stroke }
  })
  const channel = background === "green" ? 1 : 2
  expect(pixels.background[channel]).toBeGreaterThan(pixels.background[0] + 40)
  expect(pixels.stroke[0]).toBeGreaterThan(pixels.stroke[1] + 40)
  expect(pixels.stroke[0]).toBeGreaterThan(pixels.stroke[2] + 15)
  expect(pixels.stroke[0]).toBeGreaterThan(pixels.background[0] + 90)
}

test("class notes round trip preserves the submission target and capture privacy", async ({ browser, baseURL }, info) => {
  // Use an isolated seeded stack. This flow intentionally leaves records to inspect after the test.
  test.skip(process.env.THINK_MEET_NOTES_TEST !== "1", "Requires an isolated seeded stack and local ffmpeg")
  test.setTimeout(180_000)
  const contextOptions = { baseURL, ignoreHTTPSErrors: true, permissions: ["camera", "microphone"] }
  const teacher = await browser.newContext(contextOptions)
  const student = await browser.newContext(contextOptions)
  const invitee = await browser.newContext(contextOptions)
  const otherTeacher = await browser.newContext(contextOptions)
  const teacherPage = await teacher.newPage(), studentPage = await student.newPage()
  const lessonIds: string[] = [], materialIds: string[] = []
  try {
    await login(teacherPage, "teacher1")
    const roster = await (await teacher.request.get("/api/v1/students")).json()
    const enrolled = roster.filter((entry: { username: string }) => ["student1", "student2"].includes(entry.username))
    expect(enrolled).toHaveLength(2)
    const book = async (title: string, minutes: number) => {
      const response = await teacher.request.post("/api/v1/lessons", { data: {
        title, startsAt: new Date(Date.now() + minutes * 60_000).toISOString(), endsAt: null, studentIds: enrolled.map((entry: { id: string }) => entry.id),
      } })
      expect(response.ok(), await response.text()).toBeTruthy()
      const lesson = await response.json()
      lessonIds.push(lesson.id)
      return lesson
    }
    const cancelled = await book("학습지 제출 대상 확인", 10)
    const lesson = await book(`분수 연습 · 수업 노트 ${randomUUID().slice(0, 4)}`, 20)
    await apiLogin(invitee.request, "student2")
    await apiLogin(otherTeacher.request, "teacher2")
    await studentPage.setViewportSize({ width: 390, height: 844 })
    await login(studentPage, "student1")
    expect((await target(student.request)).id).toBe(cancelled.id)
    const file = await worksheet(studentPage, "#1859c7")
    const capture = studentPage.getByRole("button", { name: "이미지 올리기", exact: true })
    await capture.click()
    const submit = studentPage.getByRole("dialog", { name: "학습지 제출", exact: true })
    await submit.locator('input[type="file"]').setInputFiles(file)
    await expect(submit.getByRole("img")).toBeVisible()
    await expect(submit.getByText(`${cancelled.title} · ${lesson.teacher.name} 선생님`, { exact: true })).toBeVisible()
    expect((await teacher.request.post(`/api/v1/lessons/${cancelled.id}/cancel`)).ok()).toBeTruthy()
    const rejected = await upload(student.request, `/lessons/${cancelled.id}/worksheets`, file)
    expect(rejected.status()).toBe(409)
    expect((await rejected.json()).code).toBe("NOTE_TARGET_CHANGED")
    await expect(submit.getByRole("button", { name: `${lesson.title} · ${lesson.teacher.name} 선생님 선택`, exact: true })).toBeVisible()
    await expect(submit.getByRole("img")).toBeVisible()
    await submit.getByRole("button", { name: `${lesson.title} · ${lesson.teacher.name} 선생님 선택`, exact: true }).click()
    await studentPage.screenshot({ path: info.outputPath("web-phone-submit.png"), animations: "disabled" })
    await submit.getByRole("button", { name: "제출하기", exact: true }).click()
    await expect(studentPage.getByRole("button", { name: /제출한 학습지 1장/ }).filter({ hasText: lesson.title })).toBeVisible()
    const invalid = await upload(student.request, `/lessons/${lesson.id}/worksheets`, { ...file, buffer: Buffer.from("fake PNG") })
    expect(invalid.status()).toBe(400)
    const requestId = randomUUID()
    const retries = await Promise.all([1, 2].map(() => upload(student.request, `/lessons/${lesson.id}/worksheets`, file, requestId)))
    expect(retries.map(response => response.status())).toEqual([201, 201])
    const image = await retries[0].json()
    expect((await retries[1].json()).id).toBe(image.id)
    expect((await invitee.request.get(`${notes}/images/${image.id}`, { headers })).status()).toBe(404)
    expect((await otherTeacher.request.get(`${notes}/worksheets?lessonId=${lesson.id}`, { headers })).status()).toBe(404)
    expect((await otherTeacher.request.get(`${notes}/images/${image.id}`, { headers })).status()).toBe(404)
    expect((await student.request.get(`${notes}/images/${image.id}`, { headers: { ...headers, "X-ThinkMeet-Contract-Revision": "5" } })).status()).toBe(426)

    // The browser supplies a deterministic screen frame through the actual LiveKit screen-share path.
    await teacher.addInitScript(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement("canvas")
        canvas.width = 640; canvas.height = 360
        const context = canvas.getContext("2d")!
        const render = () => { context.fillStyle = "#16854c"; context.fillRect(0, 0, 640, 360) }
        render(); setInterval(render, 120)
        return canvas.captureStream(10)
      }
    })
    await studentPage.setViewportSize({ width: 1024, height: 900 })
    const earlier = await book("더 빠른 예정 수업", 15)
    expect((await target(student.request)).id).toBe(earlier.id)
    await enter(teacherPage, lesson.id, true)
    await enter(studentPage, lesson.id)
    expect((await target(student.request)).id).toBe(lesson.id)
    await teacherPage.getByRole("button", { name: "수업방 모드", exact: true }).click()
    await teacherPage.getByRole("button", { name: "화면 공유하기", exact: true }).click()
    await expect(studentPage.getByTestId("shared-screen")).toBeVisible()
    await drawRedStroke(studentPage)
    await expect(teacherPage.locator(".live-annotation [data-stroke-id]")).toHaveCount(1)
    await teacherPage.getByRole("button", { name: "화면 저장", exact: true }).click()
    await expect(teacherPage.getByText("이 수업에 실제 참여한 학생 모두에게 보여요.")).toBeVisible()
    await checkComposite(teacherPage, "green", info.outputPath("web-screen-capture.png"))
    await teacherPage.getByRole("button", { name: "저장하기", exact: true }).click()
    await expect(teacherPage.getByRole("dialog", { name: "화면 저장" })).toHaveCount(0)
    await studentPage.getByRole("button", { name: "화면 저장", exact: true }).click()
    await studentPage.getByRole("button", { name: "저장하기", exact: true }).click()
    await expect(studentPage.getByRole("dialog", { name: "화면 저장" })).toHaveCount(0)
    await teacherPage.getByRole("button", { name: "공유 중지", exact: true }).click()

    const pdf = await PDFDocument.create()
    for (let index = 0; index < 2; index++) {
      const page = pdf.addPage([640, 360])
      page.drawRectangle({ x: 0, y: 0, width: 640, height: 360, color: rgb(.1, .55, .22) })
      page.drawText(`Worksheet ${index + 1}`, { x: 28, y: 310, color: rgb(1, 1, 1) })
    }
    const fixtureId = lesson.id.slice(0, 8)
    const mp4Path = info.outputPath("note-video.mp4")
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x1241ba:size=640x360:rate=24", "-t", "4", "-c:v", "libx264", "-movflags", "+faststart", "-pix_fmt", "yuv420p", "-y", mp4Path])
    for (const material of [
      { name: `notes-${fixtureId}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()), tab: "교재", selector: 'canvas[aria-label$="1페이지"]', background: "green" },
      { name: `notes-${fixtureId}.mp4`, mimeType: "video/mp4", buffer: readFileSync(mp4Path), tab: "미디어", selector: '[data-testid="shared-media"]', background: "blue" },
    ] as const) {
      await openMaterials(teacherPage)
      await teacherPage.getByRole("button", { name: material.tab, exact: true }).click()
      await teacherPage.locator('input[type="file"]').setInputFiles({ name: material.name, mimeType: material.mimeType, buffer: material.buffer })
      const uploaded = material.tab === "교재"
        ? teacherPage.getByLabel("PDF 교재 선택").locator("option").filter({ hasText: material.name })
        : teacherPage.locator(".content-share").filter({ has: teacherPage.getByText(material.name, { exact: true }) })
      await expect(uploaded).toHaveCount(1)
      const materials = await (await teacher.request.get("/api/v1/materials")).json()
      const materialId = materials.find((entry: { name: string }) => entry.name === material.name).id
      materialIds.push(materialId)
      if (material.tab === "교재") {
        await shareTextbook(teacherPage, materialId)
        const panel = teacherPage.getByRole("heading", { name: "교재 불러오기" })
        if (await panel.isVisible()) await teacherPage.locator("#meeting-side-panel").getByRole("button", { name: "패널 닫기", exact: true }).click()
      } else await uploaded.click()
      await expect(studentPage.locator(material.selector)).toBeVisible()
      await drawRedStroke(studentPage)
      await expect(teacherPage.locator(".live-annotation [data-stroke-id]")).toHaveCount(1)
      await teacherPage.getByRole("button", { name: "화면 저장", exact: true }).click()
      await checkComposite(teacherPage, material.background, info.outputPath(`web-${material.tab === "교재" ? "pdf" : "video"}-capture.png`))
      if (material.tab === "교재") {
        // Change the PDF page through the active lesson socket while the confirm dialog is open.
        const cookie = (await teacher.cookies()).map(item => `${item.name}=${item.value}`).join("; ")
        const socket = io(baseURL, { autoConnect: false, transports: ["websocket"], rejectUnauthorized: false, extraHeaders: { Cookie: cookie, ...headers } })
        try {
          await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); socket.connect() })
          const changePage = await socket.timeout(5000).emitWithAck("command", { type: "document.page", lessonId: lesson.id, payload: { page: 2 } })
          expect(changePage.ok).toBeTruthy()
        } finally { socket.disconnect() }
        await expect(teacherPage.getByText("공유 자료가 바뀌었어요. 화면을 다시 저장해 주세요.")).toBeVisible()
        await expect(teacherPage.getByRole("button", { name: "저장하기", exact: true })).toBeDisabled()
        await teacherPage.getByRole("dialog").getByRole("button", { name: "닫기" }).click()
        await teacherPage.getByRole("button", { name: "화면 저장", exact: true }).click()
      }
      await teacherPage.getByRole("button", { name: "저장하기", exact: true }).click()
      await expect(teacherPage.getByRole("dialog", { name: "화면 저장" })).toHaveCount(0)
      await teacherPage.getByRole("button", { name: "공유 중지", exact: true }).click()
    }

    const rowLessonId = (row: { lesson: { id: string } }) => row.lesson.id === lesson.id
    const captureList = async (request: APIRequestContext) => (await (await request.get(`${notes}/captures`, { headers })).json()).filter(rowLessonId)
    const thisLesson = await captureList(student.request)
    expect(thisLesson.map((row: { source: string }) => row.source).sort()).toEqual(["self", "teacher", "teacher", "teacher"])
    expect(await captureList(invitee.request)).toEqual([])
    for (const row of thisLesson) expect((await invitee.request.get(`${notes}/images/${row.image.id}`, { headers })).status()).toBe(404)

    // Attendance is what unlocks teacher captures. Even another attendee cannot read a student's private captures.
    await enter(await invitee.newPage(), lesson.id)
    await expect.poll(async () => (await captureList(invitee.request)).map((row: { source: string }) => row.source)).toEqual(["teacher", "teacher", "teacher"])
    for (const row of thisLesson) {
      const response = await invitee.request.get(`${notes}/images/${row.image.id}`, { headers })
      expect(response.status()).toBe(row.source === "teacher" ? 200 : 404)
    }
    expect((await teacher.request.post(`/api/v1/lessons/${lesson.id}/end`)).ok()).toBeTruthy()
    await teacherPage.goto(`/lessons/${lesson.id}`)
    await teacherPage.getByRole("button", { name: "목록 보기", exact: true }).click()
    await teacherPage.getByRole("button", { name: /김민준.*첨삭 대기/ }).first().click()
    const correction = teacherPage.getByRole("dialog")
    await expect(correction.getByRole("img", { name: "제출한 학습지" })).toBeVisible()
    await correction.locator('input[type="file"]').setInputFiles(await worksheet(teacherPage, "#e2412a"))
    await correction.getByRole("button", { name: "첨삭 저장", exact: true }).click()
    await expect(teacherPage.getByRole("button", { name: /김민준.*첨삭 완료/ })).toBeVisible()
    const uploaded = await (await student.request.get(`${notes}/worksheets?month=${currentNoteMonth()}`, { headers })).json()
    expect(uploaded.filter((row: { lesson: { id: string } }) => row.lesson.id === lesson.id)).toHaveLength(2)
    expect(await captureList(student.request)).toEqual(thisLesson)
    for (const row of thisLesson) {
      const response = await student.request.get(`${notes}/images/${row.image.id}`, { headers })
      expect(response.status()).toBe(200)
      expect(response.headers()["content-type"]).toBe("image/jpeg")
    }
    await studentPage.goto("/")
    await studentPage.getByRole("button", { name: "보관함", exact: true }).click()
    await studentPage.getByRole("button", { name: /제출한 학습지 2장.*첨삭 받은 학습지 1장/ }).filter({ hasText: lesson.title }).click()
    await expect(studentPage.getByRole("img", { name: "첨삭 받은 학습지", exact: true })).toBeVisible()
    await studentPage.screenshot({ path: info.outputPath("web-tablet-worksheet.png"), animations: "disabled" })
    await studentPage.getByRole("dialog").getByRole("button", { name: "닫기" }).click()
    await studentPage.getByRole("button", { name: "수업 기록", exact: true }).click()
    const record = studentPage.getByRole("article").filter({ hasText: lesson.title }).getByRole("button", { name: /선생님이 저장한 화면.*3장/ })
    await expect(record).toBeVisible()
    for (const [name, width, height] of [["phone", 390, 844], ["tablet", 1024, 900]] as const) {
      await studentPage.setViewportSize({ width, height })
      await studentPage.screenshot({ path: info.outputPath(`web-${name}-records.png`), animations: "disabled" })
      await studentPage.goto("/")
      await expect(studentPage.getByRole("region", { name: "수업 노트" })).toBeVisible()
      await studentPage.screenshot({ path: info.outputPath(`web-${name}-home.png`), animations: "disabled" })
      await studentPage.getByRole("button", { name: "기록함", exact: true }).click()
      await expect(record).toBeVisible()
    }
  } finally {
    for (const id of lessonIds) {
      await teacher.request.post(`/api/v1/lessons/${id}/cancel`).catch(() => {})
      await teacher.request.post(`/api/v1/lessons/${id}/end`).catch(() => {})
    }
    for (const id of materialIds) await teacher.request.delete(`/api/v1/materials/${id}`).catch(() => {})
    await Promise.all([teacher.close(), student.close(), invitee.close(), otherTeacher.close()])
  }
})
