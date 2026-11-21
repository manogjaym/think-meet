import { randomUUID } from "node:crypto"
import { expect, test } from "@playwright/test"
import { CONTRACT_REVISION } from "../src/generated/contracts"
import { apiLogin, createLesson, login } from "./helpers"

const headers = {
  "X-ThinkMeet-Platform": "web",
  "X-ThinkMeet-Contract-Revision": String(CONTRACT_REVISION),
}

test("device checks and private waiting presence follow actual admission", async ({
  browser,
  baseURL,
}, info) => {
  const options = {
    baseURL,
    ignoreHTTPSErrors: true,
    permissions: ["camera", "microphone"],
  }
  const teacher = await browser.newContext({
    ...options,
    viewport: { width: 1024, height: 820 },
  })
  const student = await browser.newContext({
    ...options,
    viewport: { width: 390, height: 844 },
  })
  const outsider = await browser.newContext(options)
  const teacherPage = await teacher.newPage()
  const studentPage = await student.newPage()
  let path = ""
  try {
    await login(teacherPage, "teacher1")
    await login(studentPage, "student1")
    await apiLogin(outsider.request, "student2")
    const lesson = await createLesson(teacher.request, 1)
    path = `/api/v1/lessons/${lesson.id}`
    const prejoin = `/lessons/${lesson.id}/prejoin`
    const waitingPath = `${path}/waiting/${randomUUID()}`
    const ownerStatus = async () => {
      const response = await teacher.request.get(`${path}/prejoin`, { headers })
      expect(response.ok()).toBeTruthy()
      return (await response.json()).waitingStudents
    }
    await teacherPage.goto(prejoin)
    await studentPage.goto(prejoin)
    await expect(
      teacherPage.getByRole("heading", { name: "장치 상태" }),
    ).toBeVisible()
    await expect(
      studentPage.getByRole("heading", { name: "장치 상태" }),
    ).toBeVisible()
    await expect(studentPage.getByText(/^[0-9]+ ms$/)).toBeVisible()
    await expect
      .poll(() =>
        studentPage
          .locator(".join-preview video")
          .evaluate((video: HTMLVideoElement) => video.videoWidth),
      )
      .toBeGreaterThan(0)
    await expect(
      studentPage.getByRole("meter", { name: "마이크 입력 레벨" }),
    ).toBeVisible()
    await studentPage
      .getByRole("button", { name: "소리 테스트", exact: true })
      .click()
    await expect(
      studentPage.getByText("재생 완료", { exact: true }),
    ).toBeVisible()
    await expect(
      teacherPage.getByText("대기 중인 학생이 없어요."),
    ).toBeVisible()
    expect(
      (await outsider.request.get(`${path}/prejoin`, { headers })).status(),
    ).toBe(403)
    expect(
      (await outsider.request.put(waitingPath, { headers })).status(),
    ).toBe(403)
    expect(
      (await student.request.get(`${path}/prejoin`, { headers })).ok(),
    ).toBeTruthy()
    expect(
      await (await student.request.get(`${path}/prejoin`, { headers })).json(),
    ).toEqual({ status: "SCHEDULED" })

    await studentPage
      .getByRole("button", { name: "수업 시작 대기", exact: true })
      .click()
    await expect(
      studentPage.getByRole("heading", { name: "곧 수업이 시작돼요" }),
    ).toBeVisible()
    await expect
      .poll(ownerStatus)
      .toEqual([{ id: lesson.students[0].id, name: lesson.students[0].name }])
    const teacherWaiting = teacherPage.getByRole("status", {
      name: "학생 대기 상태",
    })
    await expect(teacherWaiting).toContainText(lesson.students[0].name)
    // A second client for the same account remains independent and is only counted once.
    expect((await student.request.put(waitingPath, { headers })).status()).toBe(
      204,
    )
    expect(await ownerStatus()).toHaveLength(1)
    expect(
      (await outsider.request.delete(waitingPath, { headers })).status(),
    ).toBe(204)
    expect(
      (await student.request.delete(waitingPath, { headers })).status(),
    ).toBe(204)
    await studentPage
      .getByRole("button", { name: "장치 다시 점검하기" })
      .click()
    await expect(
      studentPage.getByRole("heading", { name: "장치 상태" }),
    ).toBeVisible()
    await expect.poll(ownerStatus).toEqual([])
    await expect(teacherWaiting).toContainText("대기 중인 학생이 없어요.")
    expect((await student.request.put(waitingPath, { headers })).status()).toBe(
      204,
    )
    expect(await ownerStatus()).toHaveLength(1)
    await expect
      .poll(ownerStatus, { timeout: 25_000, intervals: [1_000] })
      .toEqual([])

    await studentPage.route("**/api/v1/lessons/*/prejoin", (route) =>
      route.abort(),
    )
    await expect(
      studentPage
        .getByRole("button", { name: "다시 시도", exact: true })
        .last(),
    ).toBeVisible()
    await studentPage.unroute("**/api/v1/lessons/*/prejoin")
    await studentPage
      .getByRole("button", { name: "다시 시도", exact: true })
      .last()
      .click()
    await expect(studentPage.getByText(/^[0-9]+ ms$/)).toBeVisible()
    await studentPage.evaluate(() => window.scrollTo(0, 0))
    await studentPage.screenshot({
      path: info.outputPath("prejoin-student-phone.png"),
      fullPage: true,
      animations: "disabled",
    })
    await studentPage
      .getByRole("button", { name: "수업 시작 대기", exact: true })
      .click()
    await expect(teacherWaiting).toContainText(lesson.students[0].name)
    await teacherPage.evaluate(() => window.scrollTo(0, 0))
    await teacherPage.screenshot({
      path: info.outputPath("prejoin-teacher-tablet.png"),
      fullPage: true,
      animations: "disabled",
    })
    await teacherPage
      .getByRole("button", { name: "수업 시작하기", exact: true })
      .click()
    await expect(teacherPage.locator(".call-connected")).toHaveText("연결됨")
    await expect(studentPage.locator(".call-connected")).toHaveText("연결됨")
    expect(await ownerStatus()).toEqual([])
  } finally {
    if (path) {
      const response = await teacher.request
        .post(`${path}/end`)
        .catch(() => null)
      if (!response?.ok())
        await teacher.request.post(`${path}/cancel`).catch(() => {})
    }
    await Promise.all([teacher.close(), student.close(), outsider.close()])
  }
})

test("open-class wait ends on cancellation and camera access errors leave joining available", async ({
  browser,
  baseURL,
}) => {
  const teacher = await browser.newContext({ baseURL, ignoreHTTPSErrors: true })
  const student = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    permissions: ["camera", "microphone"],
  })
  let path = ""
  try {
    await apiLogin(teacher.request, "teacher1")
    const booked = await teacher.request.post("/api/v1/lessons", {
      data: {
        title: "장치 점검 공개 수업",
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        endsAt: null,
        accessMode: "OPEN",
        studentIds: [],
      },
    })
    expect(booked.ok(), await booked.text()).toBeTruthy()
    const lesson = await booked.json()
    path = `/api/v1/lessons/${lesson.id}`
    const studentPage = await student.newPage()
    await studentPage.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      )
      navigator.mediaDevices.getUserMedia = (constraints) =>
        constraints?.video
          ? Promise.reject(
              new DOMException("Denied in test", "NotAllowedError"),
            )
          : original(constraints)
    })
    await login(studentPage, "student2")
    await studentPage.goto(`/lessons/${lesson.id}/prejoin`)
    const checks = studentPage.getByRole("region", { name: "장치 상태" })
    await expect(checks.getByText("권한 필요", { exact: true })).toBeVisible()
    await expect(
      checks.getByRole("button", { name: "다시 시도", exact: true }),
    ).toBeVisible()
    const waitingPath = `${path}/waiting/${randomUUID()}`
    expect((await student.request.put(waitingPath, { headers })).status()).toBe(
      403,
    )
    await studentPage
      .getByRole("button", { name: "수업 시작 대기", exact: true })
      .click()
    await expect(
      studentPage.getByRole("heading", { name: "곧 수업이 시작돼요" }),
    ).toBeVisible()
    await expect
      .poll(async () => {
        const response = await teacher.request.get(`${path}/prejoin`, {
          headers,
        })
        return (await response.json()).waitingStudents.length
      })
      .toBe(1)
    expect((await teacher.request.post(`${path}/cancel`)).ok()).toBeTruthy()
    await expect(studentPage).toHaveURL(/error\/cancelled/)
    expect((await student.request.put(waitingPath, { headers })).status()).toBe(
      409,
    )
  } finally {
    if (path) await teacher.request.post(`${path}/cancel`).catch(() => {})
    await Promise.all([teacher.close(), student.close()])
  }
})
