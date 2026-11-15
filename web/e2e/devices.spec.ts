import { test, expect } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { login, createLesson } from './helpers'

test('screen sharing transfers real frames, replacement stops capture, and voluntary leave is distinct from removal', async ({ browser, baseURL }) => {
  test.setTimeout(210000)
  const teacherContext = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'] })
  const studentContext = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'] })
  await teacherContext.addInitScript(() => {
    if (!navigator.mediaDevices?.getDisplayMedia) return
    const getDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
    const captures: MediaStreamTrack[] = []
    ;(window as unknown as { screenCaptures: MediaStreamTrack[] }).screenCaptures = captures
    navigator.mediaDevices.getDisplayMedia = async (...args) => { const stream = await getDisplayMedia(...args); captures.push(...stream.getTracks()); return stream }
  })
  const teacher = await teacherContext.newPage(), student = await studentContext.newPage()
  let lesson: any
  let materialId: string | undefined
  try {
    await login(teacher, 'teacher1')
    lesson = await createLesson(teacherContext.request, 1)
    await login(student, lesson.students[0].username)
    await teacher.goto(`/lessons/${lesson.id}/prejoin`)
    await teacher.getByRole('button', { name: '수업 시작하기', exact: true }).click()
    await expect(teacher.locator('.call-connected')).toHaveText('연결됨')
    await student.goto(`/lessons/${lesson.id}/prejoin`)
    await student.getByRole('button', { name: '지금 참여하기', exact: true }).click()
    await expect(student.locator('.call-connected')).toHaveText('연결됨')
    await teacher.getByRole('button', { name: '화면 공유', exact: true }).click()
    await teacher.getByRole('button', { name: '전체 화면', exact: false }).click()
    await teacher.getByRole('button', { name: '화면 공유하기', exact: true }).click()
    await expect(student.getByTestId('shared-screen')).toBeVisible({ timeout: 30000 })
    await expect.poll(async () => student.getByTestId('shared-screen').evaluate((video: HTMLVideoElement) => video.readyState >= 2 && video.videoWidth > 0)).toBe(true)
    const shared = await (await teacherContext.request.get(`/api/v1/lessons/${lesson.id}/snapshot`)).json()
    expect(shared.share.type).toBe('screen')
    expect(shared.share.ownerId).toBe(lesson.teacher.id)
    const pdf = await PDFDocument.create(); pdf.addPage([500, 350])
    const uploaded = await teacherContext.request.post('/api/v1/materials', { multipart: { file: { name: 'screen-replacement.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) } } })
    expect(uploaded.ok()).toBe(true); materialId = (await uploaded.json()).id
    await teacher.locator('.call-controls').getByRole('button', { name: '수업 자료', exact: true }).click()
    await teacher.getByRole('button', { name: '문서', exact: true }).click()
    await teacher.locator('.content-share').filter({ hasText: 'screen-replacement.pdf' }).first().click()
    await expect(student.getByLabel('screen-replacement.pdf 1페이지', { exact: true })).toBeVisible()
    await expect(teacher.locator('.call-controls').getByRole('button', { name: '화면 공유', exact: true })).toBeVisible()
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
