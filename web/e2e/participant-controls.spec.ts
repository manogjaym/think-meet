import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

// Self-contained so it can run against an isolated verification server:
// BASE_URL=<origin> TEST_PASSWORD=<seed password> npx playwright test e2e/participant-controls.spec.ts
const password = process.env.TEST_PASSWORD || 'test123'
const screenshots = process.env.PARTICIPANT_CONTROLS_SCREENSHOTS

async function login(page: Page, username: string) {
  await page.goto('/login')
  await page.getByLabel('아이디', { exact: true }).fill(username)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page.getByRole('heading', { name: '내 수업', exact: true })).toBeVisible()
}
async function createLesson(request: APIRequestContext) {
  const roster = await (await request.get('/api/v1/students')).json()
  const student = roster.find((entry: { username: string }) => entry.username === 'student1')
  const response = await request.post('/api/v1/lessons', { data: { title: `제어 검증 ${Date.now()}`, description: '참여자 제어 자동 검증', startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString(), studentIds: [student.id] } })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}
async function capture(page: Page, name: string, sizes: Array<[string, number, number]>) {
  if (!screenshots) return
  for (const [label, width, height] of sizes) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${screenshots}/${name}-${label}.png` })
  }
  await page.setViewportSize({ width: 1280, height: 800 })
}

test('teacher controls a student microphone, camera and annotation permission; students control only themselves', async ({ browser, baseURL }) => {
  test.setTimeout(180000)
  const options = { baseURL, ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 800 } }
  const teacherContext = await browser.newContext(options), studentContext = await browser.newContext(options)
  // Synthetic screen capture keeps the test independent of the OS picker.
  await teacherContext.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 640, height: 360 })
      const context = canvas.getContext('2d')!
      let frame = 0
      setInterval(() => { context.fillStyle = frame++ % 2 ? '#295ca3' : '#92baff'; context.fillRect(0, 0, 640, 360) }, 100)
      return canvas.captureStream(15)
    }
  })
  const teacher = await teacherContext.newPage(), student = await studentContext.newPage()
  const errors: string[] = []
  for (const page of [teacher, student]) page.on('pageerror', error => errors.push(error.message))
  let lesson: any
  try {
    await login(teacher, 'teacher1')
    lesson = await createLesson(teacherContext.request)
    const studentUser = lesson.students[0]
    await login(student, studentUser.username)
    await teacher.goto(`/lessons/${lesson.id}/prejoin`)
    await teacher.getByRole('button', { name: '화상미팅 입장', exact: true }).click()
    await expect(teacher.locator('.call-connected')).toHaveText('연결됨')
    await student.goto(`/lessons/${lesson.id}/prejoin`)
    await student.getByRole('button', { name: '지금 참여하기', exact: true }).click()
    await expect(student.locator('.call-connected')).toHaveText('연결됨')

    // Start the lesson in classroom mode and dismiss the screen picker; annotation permission needs lesson modes.
    await teacher.getByRole('button', { name: '수업방 모드', exact: true }).click()
    await teacher.getByRole('dialog', { name: '화면 공유', exact: true }).getByRole('button', { name: '취소', exact: true }).click()

    const studentName = studentUser.name
    const teacherName = lesson.teacher.name
    const remoteControls = teacher.getByRole('group', { name: `${studentName} 참여자 제어` })
    await expect(remoteControls).toBeVisible()
    await expect(teacher.getByRole('group', { name: `${teacherName} 참여자 제어` })).toBeVisible()
    await expect(student.getByRole('group', { name: `${studentName} 참여자 제어` })).toBeVisible()
    await expect(student.getByRole('group', { name: `${teacherName} 참여자 제어` })).toHaveCount(0)
    await expect(student.getByRole('button', { name: /판서 허용/ })).toHaveCount(0)

    // Microphone and camera off/on reach the student's device and show a notice there.
    await remoteControls.getByRole('button', { name: `${studentName} 마이크 끄기`, exact: true }).click()
    await expect(student.getByRole('status').filter({ hasText: '선생님이 마이크를 껐어요.' })).toBeVisible()
    await expect(student.getByRole('button', { name: `${studentName} 마이크 켜기`, exact: true })).toBeVisible()
    await expect(remoteControls.getByRole('button', { name: `${studentName} 마이크 켜기`, exact: true })).toBeVisible()
    await remoteControls.getByRole('button', { name: `${studentName} 카메라 끄기`, exact: true }).click()
    await expect(student.getByRole('status').filter({ hasText: '선생님이 카메라를 껐어요.' })).toBeVisible()
    await expect(remoteControls.getByRole('button', { name: `${studentName} 카메라 켜기`, exact: true })).toBeVisible()
    await capture(teacher, 'web-teacher-off', [['desktop', 1280, 800], ['tablet', 1024, 820], ['phone', 390, 844]])
    await capture(student, 'web-student-notice', [['tablet', 1024, 820], ['phone', 390, 844]])
    await remoteControls.getByRole('button', { name: `${studentName} 마이크 켜기`, exact: true }).click()
    await expect(remoteControls.getByRole('button', { name: `${studentName} 마이크 끄기`, exact: true })).toBeVisible()
    await remoteControls.getByRole('button', { name: `${studentName} 카메라 켜기`, exact: true }).click()
    await expect(remoteControls.getByRole('button', { name: `${studentName} 카메라 끄기`, exact: true })).toBeVisible()

    // The student's own buttons still work and the teacher sees the real state.
    await student.getByRole('button', { name: `${studentName} 마이크 끄기`, exact: true }).click()
    await expect(remoteControls.getByRole('button', { name: `${studentName} 마이크 켜기`, exact: true })).toBeVisible()

    // Annotation permission is stored and announced to the student.
    const annotation = remoteControls.getByRole('button', { name: `${studentName} 판서 허용`, exact: true })
    await expect(annotation).toHaveAttribute('aria-pressed', 'false')
    await annotation.click()
    await expect(annotation).toHaveAttribute('aria-pressed', 'true')
    await expect(student.getByRole('status').filter({ hasText: '선생님이 판서를 허용했어요.' })).toBeVisible()
    await capture(teacher, 'web-teacher-annotation', [['desktop', 1280, 800], ['tablet', 1024, 820], ['phone', 390, 844]])
    await annotation.click()
    await expect(annotation).toHaveAttribute('aria-pressed', 'false')
    await expect(student.getByRole('status').filter({ hasText: '선생님이 판서 허용을 해제했어요.' })).toBeVisible()

    // On a shared screen the student's annotation tools follow the permission.
    await teacher.getByRole('button', { name: '수업방 모드', exact: true }).click()
    const sourceDialog = teacher.getByRole('dialog', { name: '화면 공유', exact: true })
    await sourceDialog.getByRole('button', { name: '전체 화면', exact: false }).click()
    await sourceDialog.getByRole('button', { name: '화면 공유하기', exact: true }).click()
    await expect(student.getByTestId('shared-screen')).toBeVisible({ timeout: 30000 })
    const annotateEntry = student.getByRole('button', { name: '판서 시작', exact: true })
    await expect(annotateEntry).toHaveCount(0)
    const stageControls = teacher.getByRole('group', { name: `${studentName} 참여자 제어` })
    await stageControls.getByRole('button', { name: `${studentName} 판서 허용`, exact: true }).click()
    await expect(annotateEntry).toBeVisible()
    await annotateEntry.click()
    await expect(student.getByRole('button', { name: '판서 종료', exact: true })).toBeVisible()
    await capture(teacher, 'web-teacher-stage', [['desktop', 1280, 800], ['tablet', 1024, 820], ['phone', 390, 844]])
    await capture(student, 'web-student-stage', [['tablet', 1024, 820], ['phone', 390, 844]])
    await stageControls.getByRole('button', { name: `${studentName} 판서 허용`, exact: true }).click()
    await expect(student.getByRole('button', { name: '판서 종료', exact: true })).toHaveCount(0)
    await expect(annotateEntry).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    if (lesson) await teacherContext.request.post(`/api/v1/lessons/${lesson.id}/end`).catch(() => {})
    await teacherContext.close(); await studentContext.close()
  }
})
