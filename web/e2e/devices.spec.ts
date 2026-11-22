import { test, expect, type WebSocketRoute } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { login, createLesson, openMaterials, shareTextbook } from './helpers'

test('lesson mode buttons open screen sharing and student selection, and switching stops only a confirmed capture', async ({ browser, baseURL }, info) => {
  test.setTimeout(210000)
  const teacherContext = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'] })
  const studentContext = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'] })
  const synthetic = process.env.SCREEN_SHARE_TEST_CAPTURE === 'synthetic'
  const mediaSockets: WebSocketRoute[] = []
  if (synthetic) await teacherContext.routeWebSocket(url => url.pathname.startsWith('/livekit/rtc'), route => {
    mediaSockets.push(route)
    route.connectToServer()
  })
  await teacherContext.addInitScript(synthetic => {
    if (!navigator.mediaDevices?.getDisplayMedia) return
    const getDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
    const captures: MediaStreamTrack[] = []
    ;(window as unknown as { screenCaptures: MediaStreamTrack[] }).screenCaptures = captures
    navigator.mediaDevices.getDisplayMedia = async (...args) => {
      if (!synthetic) {
        const stream = await getDisplayMedia(...args)
        captures.push(...stream.getTracks())
        return stream
      }
      const canvas = document.createElement('canvas')
      canvas.width = 640; canvas.height = 360
      const context = canvas.getContext('2d')!
      const audio = new AudioContext()
      const oscillator = audio.createOscillator()
      const output = audio.createMediaStreamDestination()
      oscillator.connect(output)
      oscillator.start()
      await audio.resume()
      const stream = new MediaStream([...canvas.captureStream(15).getVideoTracks(), ...output.stream.getAudioTracks()])
      const tracks = stream.getTracks()
      captures.push(...tracks)
      let frame = 0
      const paint = () => {
        context.fillStyle = frame++ % 2 ? '#295ca3' : '#92baff'
        context.fillRect(0, 0, canvas.width, canvas.height)
      }
      paint()
      const timer = setInterval(() => {
        if (tracks.every(track => track.readyState === 'ended')) { clearInterval(timer); void audio.close() }
        else paint()
      }, 100)
      return stream
    }
  }, synthetic)
  const teacher = await teacherContext.newPage(), student = await studentContext.newPage()
  const classroom = teacher.getByRole('button', { name: '수업방 모드', exact: true })
  const mirroring = teacher.getByRole('button', { name: '미러링 모드', exact: true })
  const picker = teacher.getByRole('dialog', { name: '공유를 요청할 학생 선택' })
  const sourceDialog = teacher.getByRole('dialog', { name: '화면 공유', exact: true })
  async function startScreenShare() {
    await classroom.click()
    await sourceDialog.getByRole('button', { name: '전체 화면', exact: false }).click()
    await sourceDialog.getByRole('button', { name: '화면 공유하기', exact: true }).click()
    await expect(student.getByTestId('shared-screen')).toBeVisible({ timeout: 30000 })
    await expect.poll(() => student.getByTestId('shared-screen').evaluate((video: HTMLVideoElement) => video.readyState >= 2 && video.videoWidth > 0)).toBe(true)
  }
  let lesson: any
  let materialId: string | undefined
  try {
    await login(teacher, 'teacher1')
    lesson = await createLesson(teacherContext.request, 1)
    await login(student, lesson.students[0].username)
    await teacher.goto(`/lessons/${lesson.id}/prejoin`)
    await teacher.getByRole('button', { name: '화상미팅 입장', exact: true }).click()
    await expect(teacher.locator('.call-connected')).toHaveText('연결됨')
    await student.goto(`/lessons/${lesson.id}/prejoin`)
    await student.getByRole('button', { name: '지금 참여하기', exact: true }).click()
    await expect(student.locator('.call-connected')).toHaveText('연결됨')
    await expect(teacher.getByRole('button', { name: '수업 시작', exact: true })).toHaveCount(0)
    await expect(classroom).toHaveAttribute('aria-pressed', 'false')
    await expect(mirroring).toHaveAttribute('aria-pressed', 'false')
    await expect(teacher.locator('.call-controls').getByRole('button', { name: '화면 공유', exact: true })).toHaveCount(0)
    await expect(teacher.locator('.call-controls').getByRole('button', { name: '수업 자료', exact: true })).toHaveCount(0)
    await expect(teacher.locator('.materials-card')).toBeVisible()
    await expect(student.locator('.materials-card')).toHaveCount(0)
    await expect(teacher.locator('.meeting-timer')).toHaveCount(0)
    await expect(student.getByRole('button', { name: /^(수업 시작|수업방 모드|미러링 모드)$/ })).toHaveCount(0)
    await mirroring.click()
    await expect(picker).toBeVisible()
    // The mode is only shown as entered once a share or request exists, not while its popup is open.
    await expect(mirroring).toHaveAttribute('aria-pressed', 'false')
    await expect(teacher.locator('#meeting-side-panel .side-panel')).toBeHidden()
    const request = picker.getByRole('button', { name: '공유 요청', exact: true })
    await expect(request).toBeDisabled()
    await picker.getByRole('button', { name: lesson.students[0].name, exact: true }).click()
    await expect(request).toBeEnabled()
    await expect(student.locator('.remote-assistance-status')).toHaveCount(0)
    await expect(teacher.locator('.meeting-timer')).toBeVisible()
    await expect(student.getByRole('button', { name: /^(수업 시작|수업방 모드|미러링 모드)$/ })).toHaveCount(0)
    for (const [size, viewport] of Object.entries({ phone: { width: 390, height: 844 }, tablet: { width: 1024, height: 820 } })) {
      for (const [role, page] of [['teacher', teacher], ['student', student]] as const) {
        await page.setViewportSize(viewport)
        await page.screenshot({ path: info.outputPath(`lesson-modes-${role}-${size}.png`), animations: 'disabled' })
      }
    }
    await request.click()
    await expect(picker.getByRole('alert')).toContainText('Android')
    await picker.getByRole('button', { name: '취소', exact: true }).click()
    await expect(picker).toHaveCount(0)
    await expect(mirroring).toHaveAttribute('aria-pressed', 'false')
    // The owner rail's materials card switches to classroom mode and opens the textbook panel in place of the card.
    const card = teacher.locator('.materials-card')
    await card.getByRole('button', { name: '숙제계획', exact: true }).click()
    await expect(card.getByRole('status')).toHaveText('준비 중인 기능이에요.')
    await card.getByRole('button', { name: '교재 불러오기', exact: true }).click()
    await expect(teacher.getByRole('heading', { name: '교재 불러오기', exact: true })).toBeVisible()
    await expect(card).toHaveCount(0)
    await expect.poll(async () => (await (await teacherContext.request.get(`/api/v1/lessons/${lesson.id}/snapshot`)).json()).instruction?.phase).toBe('classroom')
    await teacher.locator('#meeting-side-panel').getByRole('button', { name: '패널 닫기', exact: true }).click()
    await expect(card).toBeVisible()
    await classroom.click()
    await sourceDialog.getByRole('button', { name: '취소', exact: true }).click()
    await expect(classroom).toHaveAttribute('aria-pressed', 'false')
    await startScreenShare()
    // Classroom mode keeps annotation on: the tools sit in the footer under the shared screen on both sides.
    for (const page of [teacher, student]) {
      await expect(page.locator('.stage-footer .annotation-bar')).toBeVisible()
      await expect(page.getByRole('button', { name: '판서 시작', exact: true })).toHaveCount(0)
      const content = (await page.locator('.live-shared-content').boundingBox())!
      const bar = (await page.locator('.stage-footer .annotation-bar').boundingBox())!
      expect(bar.y).toBeGreaterThanOrEqual(content.y + content.height - 1)
    }
    const mute = teacher.getByRole('button', { name: '마이크 끄기', exact: true })
    if (!(await mute.isVisible())) await teacher.getByRole('button', { name: '마이크 켜기', exact: true }).click()
    const remoteMic = student.locator(`.shared-participants [data-participant="${lesson.teacher.id}"] .mic-state`)
    await expect(remoteMic).toHaveAttribute('title', '마이크 켜짐')
    const originalStreams = await Promise.all([teacher, student].map(async page => {
      const screen = page.getByTestId('shared-screen')
      await expect.poll(() => screen.evaluate((video: HTMLVideoElement) => video.readyState >= 2)).toBe(true)
      return screen.evaluateHandle((video: HTMLVideoElement) => video.srcObject)
    }))
    await mute.click()
    await expect(remoteMic).toHaveAttribute('title', '음소거')
    for (const [index, page] of [teacher, student].entries()) {
      const stream = originalStreams[index]
      expect(await page.getByTestId('shared-screen').evaluate((video: HTMLVideoElement, original) =>
        video.srcObject === original && video.readyState >= 2, stream)).toBe(true)
      await stream.dispose()
    }
    const shared = await (await teacherContext.request.get(`/api/v1/lessons/${lesson.id}/snapshot`)).json()
    expect(shared.share.type).toBe('screen')
    expect(shared.share.ownerId).toBe(lesson.teacher.id)
    if (synthetic) {
      const count = mediaSockets.length
      expect(count).toBeGreaterThan(0)
      await mediaSockets.at(-1)!.close({ code: 1012 })
      await expect.poll(() => mediaSockets.length, { timeout: 30_000 }).toBeGreaterThan(count)
      await expect(teacher.locator('.call-connected')).toHaveText('연결됨')
      const recovered = await (await teacherContext.request.get(`/api/v1/lessons/${lesson.id}/snapshot`)).json()
      expect(recovered.share.id).toBe(shared.share.id)
      await expect.poll(() => student.getByTestId('shared-screen').evaluate((video: HTMLVideoElement) => video.readyState >= 2 && video.videoWidth > 0)).toBe(true)
    }
    const pdf = await PDFDocument.create(); pdf.addPage([500, 350])
    const uploaded = await teacherContext.request.post('/api/v1/materials', { multipart: { file: { name: 'screen-replacement.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) } } })
    expect(uploaded.ok()).toBe(true); materialId = (await uploaded.json()).id
    await openMaterials(teacher)
    await shareTextbook(teacher, materialId!)
    await expect(student.getByLabel('screen-replacement.pdf 1페이지', { exact: true })).toBeVisible()
    await expect(teacher.locator('.call-controls').getByRole('button', { name: '화면 공유', exact: true })).toHaveCount(0)
    // Browser end/share replacement must stop the actual capture track, not just hide it.
    await expect.poll(async () => teacher.evaluate(() => {
      const tracks = (window as unknown as { screenCaptures: MediaStreamTrack[] }).screenCaptures
      return tracks.length > 0 && tracks.every(track => track.readyState === 'ended')
    })).toBe(true)
    await expect.poll(async () => {
      const response = await teacherContext.request.get(`/api/v1/lessons/${lesson.id}/snapshot`)
      const snapshot = await response.json()
      return snapshot.share?.type
    }).toBe('document')
    await teacher.getByRole('button', { name: '공유 중지', exact: true }).click()
    await startScreenShare()
    await teacher.getByRole('button', { name: '공유 중지', exact: true }).click()
    for (const page of [teacher, student]) await expect(page.getByTestId('shared-screen')).toHaveCount(0)
    await expect.poll(() => teacher.evaluate(() =>
      (window as unknown as { screenCaptures: MediaStreamTrack[] }).screenCaptures.every(track => track.readyState === 'ended'))).toBe(true)
    await startScreenShare()
    await mirroring.click()
    const switchDialog = teacher.getByRole('dialog', { name: '수업 모드를 바꿀까요?' })
    await switchDialog.getByRole('button', { name: '취소', exact: true }).click()
    await expect(classroom).toHaveAttribute('aria-pressed', 'true')
    await expect(student.getByTestId('shared-screen')).toBeVisible()
    await mirroring.click()
    await switchDialog.getByRole('button', { name: '종료하고 전환' }).click()
    await expect(picker).toBeVisible()
    await expect(mirroring).toHaveAttribute('aria-pressed', 'false')
    await expect(classroom).toHaveAttribute('aria-pressed', 'false')
    await expect(picker.getByRole('button', { name: lesson.students[0].name, exact: true })).toBeVisible()
    await expect(teacher.locator('#meeting-side-panel .side-panel')).toBeHidden()
    await expect(student.getByTestId('shared-screen')).toHaveCount(0)
    await expect.poll(() => teacher.evaluate(() =>
      (window as unknown as { screenCaptures: MediaStreamTrack[] }).screenCaptures.every(track => track.readyState === 'ended'))).toBe(true)
    await teacher.reload()
    await expect(mirroring).toHaveAttribute('aria-pressed', 'false')
    await expect(picker).toHaveCount(0)
    await startScreenShare()
    await expect(classroom).toHaveAttribute('aria-pressed', 'true')
    await teacher.evaluate(() => {
      const tracks = (window as unknown as { screenCaptures: MediaStreamTrack[] }).screenCaptures
      const video = tracks.find(track => track.kind === 'video' && track.readyState === 'live')
      if (!video) throw new Error('No active screen capture')
      video.stop()
      // stop() does not emit the browser's capture-ended event.
      video.dispatchEvent(new Event('ended'))
    })
    for (const page of [teacher, student]) await expect(page.getByTestId('shared-screen')).toHaveCount(0)
    await expect.poll(() => teacher.evaluate(() =>
      (window as unknown as { screenCaptures: MediaStreamTrack[] }).screenCaptures.every(track => track.readyState === 'ended'))).toBe(true)
    await student.getByRole('button', { name: '수업 나가기', exact: true }).click()
    await student.getByRole('button', { name: '수업 나가기', exact: true }).last().click()
    await expect(student.getByRole('heading', { name: '수업을 나왔어요', exact: true })).toBeVisible()
    await expect(teacher.locator('.call-connected')).toHaveText('연결됨')
    const current = await (await teacherContext.request.get(`/api/v1/lessons/${lesson.id}`)).json()
    expect(current.status).toBe('LIVE')
    await student.goto(`/lessons/${lesson.id}/prejoin`)
    await student.getByRole('button', { name: '지금 참여하기', exact: true }).click()
    await expect(student.locator('.call-connected')).toHaveText('연결됨')
    // A second tab replaces the same account, while the old one gets a clear moved-session notice.
    const replacement = await studentContext.newPage()
    await replacement.goto(`/lessons/${lesson.id}/prejoin`)
    await replacement.getByRole('button', { name: '지금 참여하기', exact: true }).click()
    await expect(replacement.locator('.call-connected')).toHaveText('연결됨')
    await expect(student.getByRole('heading', { name: /다른 기기/ })).toBeVisible()
    await replacement.close()
  } finally {
    if (lesson) await teacherContext.request.post(`/api/v1/lessons/${lesson.id}/end`).catch(() => {})
    if (materialId) await teacherContext.request.delete(`/api/v1/materials/${materialId}`).catch(() => {})
    await teacherContext.close(); await studentContext.close()
  }
})
