import { expect, test, type Page } from "@playwright/test"
import type { ApiLesson } from "../src/lib/api"
import { createLesson, login } from "./helpers"

type DeviceProbe = {
  previewWrites: number
  analyserInputs: string[]
  analyserCloses: number
  samples: number
}

type TestWindow = Window & {
  deviceProbe: DeviceProbe
  microphoneGain: GainNode
}

const readProbe = (page: Page) => page.evaluate(() => (window as unknown as TestWindow).deviceProbe)

function observeTeacherDevices() {
  const probe: DeviceProbe = { previewWrites: 0, analyserInputs: [], analyserCloses: 0, samples: 0 }
  Object.assign(window, { deviceProbe: probe })
  const prototype = HTMLMediaElement.prototype
  const srcObject = Object.getOwnPropertyDescriptor(prototype, "srcObject")!
  Object.defineProperty(prototype, "srcObject", {
    ...srcObject,
    set(this: HTMLMediaElement, stream: MediaProvider | null) {
      if (this.matches(".camera-mini video")) probe.previewWrites++
      srcObject.set!.call(this, stream)
    },
  })

  const inputIds = new WeakMap<BaseAudioContext, string>()
  const observedContexts = new WeakSet<BaseAudioContext>()
  const observedAnalysers = new WeakSet<AnalyserNode>()
  const createSource = AudioContext.prototype.createMediaStreamSource
  AudioContext.prototype.createMediaStreamSource = function (stream) {
    const id = stream.getAudioTracks()[0]?.id
    if (id) inputIds.set(this, id)
    return createSource.call(this, stream)
  }
  const createAnalyser = BaseAudioContext.prototype.createAnalyser
  BaseAudioContext.prototype.createAnalyser = function () {
    const analyser = createAnalyser.call(this)
    const id = inputIds.get(this)
    // The settings meter creates its stream source before creating its analyser.
    if (id) {
      observedContexts.add(this)
      observedAnalysers.add(analyser)
      probe.analyserInputs.push(id)
    }
    return analyser
  }
  const sample = AnalyserNode.prototype.getByteFrequencyData
  AnalyserNode.prototype.getByteFrequencyData = function (data) {
    if (observedAnalysers.has(this)) probe.samples++
    sample.call(this, data)
  }
  const close = AudioContext.prototype.close
  AudioContext.prototype.close = function () {
    if (observedContexts.has(this)) probe.analyserCloses++
    return close.call(this)
  }
}

function installStudentMicrophone() {
  const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  let audio: AudioContext | undefined
  let gain: GainNode | undefined
  navigator.mediaDevices.getUserMedia = async constraints => {
    if (!constraints?.audio) return getUserMedia(constraints)
    if (!audio || !gain) {
      audio = new AudioContext()
      gain = audio.createGain()
      gain.gain.value = 0
      const tone = audio.createOscillator()
      tone.connect(gain)
      tone.start()
      Object.assign(window, { microphoneGain: gain })
    }
    const destination = audio.createMediaStreamDestination()
    gain.connect(destination)
    await audio.resume()
    const video = constraints.video ? (await getUserMedia({ video: constraints.video })).getVideoTracks() : []
    return new MediaStream([...destination.stream.getAudioTracks(), ...video])
  }
}

test("participant and speaker updates keep the camera preview and microphone meter running", async ({ browser, baseURL }) => {
  const contextOptions = { baseURL, ignoreHTTPSErrors: true, permissions: ["camera", "microphone"] }
  const teacherContext = await browser.newContext(contextOptions)
  const studentContext = await browser.newContext(contextOptions)
  let lessonId: string | undefined
  try {
    await teacherContext.addInitScript(observeTeacherDevices)
    await studentContext.addInitScript(installStudentMicrophone)
    const teacher = await teacherContext.newPage()
    const student = await studentContext.newPage()
    await login(teacher, "teacher1")
    const lesson: ApiLesson = await createLesson(teacherContext.request, 1)
    lessonId = lesson.id
    const [studentUser] = lesson.students
    await login(student, studentUser.username)

    const prejoin = `/lessons/${lesson.id}/prejoin`
    await teacher.goto(prejoin)
    await teacher.getByRole("button", { name: "화상미팅 입장", exact: true }).click()
    await expect(teacher.locator(".call-connected")).toHaveText("연결됨")
    const controls = teacher.locator(".call-controls")
    await controls.getByRole("button", { name: "더보기", exact: true }).click()
    await teacher.getByRole("button", { name: /카메라·마이크 설정/ }).click()
    const preview = teacher.locator(".camera-mini video")
    const meter = teacher.getByRole("meter", { name: "마이크 입력 레벨" })
    await expect.poll(() => preview.evaluate((video: HTMLVideoElement) => video.readyState >= 2)).toBe(true)
    await expect.poll(async () => (await readProbe(teacher)).samples).toBeGreaterThan(0)
    const initial = await readProbe(teacher)
    expect(initial.previewWrites).toBeGreaterThan(0)
    expect(initial.analyserInputs).toHaveLength(1)
    const devicesStayRunning = async () => {
      const { samples } = await readProbe(teacher)
      await expect.poll(async () => (await readProbe(teacher)).samples).toBeGreaterThan(samples)
      expect(await readProbe(teacher)).toMatchObject({
        previewWrites: initial.previewWrites,
        analyserInputs: initial.analyserInputs,
        analyserCloses: initial.analyserCloses,
      })
    }

    await teacher.getByRole("button", { name: "발표자 보기로 전환" }).click()
    await student.goto(prejoin)
    await student.getByRole("button", { name: "지금 참여하기", exact: true }).click()
    await expect(student.locator(".call-connected")).toHaveText("연결됨")
    const tiles = teacher.locator(".video-grid [data-participant]")
    const studentTile = tiles.and(teacher.locator(`[data-participant="${studentUser.id}"]`))
    await expect(studentTile).toBeVisible()
    await expect(teacher.getByTestId("remote-audio")).toHaveCount(1)
    await devicesStayRunning()

    const speak = (level: number) => student.evaluate(value => {
      (window as unknown as TestWindow).microphoneGain.gain.value = value
    }, level)
    await speak(0.4)
    await expect(studentTile).toHaveClass(/is-speaking/)
    await expect(tiles.first()).toHaveAttribute("data-participant", studentUser.id)
    await devicesStayRunning()
    await speak(0)
    await expect(studentTile).not.toHaveClass(/is-speaking/)
    await expect(tiles.first()).toHaveAttribute("data-participant", lesson.teacher.id)
    await devicesStayRunning()

    await student.getByRole("button", { name: "수업 나가기", exact: true }).click()
    await student.getByRole("button", { name: "수업 나가기", exact: true }).last().click()
    await expect(studentTile).toHaveCount(0)
    await expect(teacher.getByTestId("remote-audio")).toHaveCount(0)
    await devicesStayRunning()

    await controls.getByRole("button", { name: "카메라 끄기", exact: true }).click()
    await expect(preview).toHaveCount(0)
    await controls.getByRole("button", { name: "카메라 켜기", exact: true }).click()
    await expect.poll(() => preview.evaluate((video: HTMLVideoElement) => video.readyState >= 2)).toBe(true)
    const cameraRestart = await readProbe(teacher)
    expect(cameraRestart.previewWrites).toBeGreaterThan(initial.previewWrites)
    expect(cameraRestart.analyserInputs).toEqual(initial.analyserInputs)

    await controls.getByRole("button", { name: "마이크 끄기", exact: true }).click()
    await expect(meter).toHaveAttribute("aria-valuenow", "0")
    await expect.poll(async () => (await readProbe(teacher)).analyserCloses).toBe(initial.analyserCloses + 1)
    await controls.getByRole("button", { name: "마이크 켜기", exact: true }).click()
    await expect.poll(async () => (await readProbe(teacher)).analyserInputs.length).toBe(2)
    const unmuted = await readProbe(teacher)
    await expect.poll(async () => (await readProbe(teacher)).samples).toBeGreaterThan(unmuted.samples)

    const noise = teacher.getByRole("switch", { name: "노이즈 캔슬링" })
    const noiseWasOn = (await noise.getAttribute("aria-checked")) === "true"
    await noise.click()
    await expect(noise).toHaveAttribute("aria-checked", String(!noiseWasOn))
    await expect.poll(async () => (await readProbe(teacher)).analyserInputs.length).toBe(3)
    const restarted = await readProbe(teacher)
    expect(restarted.analyserInputs[2]).not.toBe(unmuted.analyserInputs[1])
    expect(restarted.analyserCloses).toBe(initial.analyserCloses + 2)
    expect(restarted.previewWrites).toBe(cameraRestart.previewWrites)
    await expect.poll(async () => (await readProbe(teacher)).samples).toBeGreaterThan(restarted.samples)
  } finally {
    if (lessonId) await teacherContext.request.post(`/api/v1/lessons/${lessonId}/end`).catch(() => {})
    await Promise.all([teacherContext.close(), studentContext.close()])
  }
})
