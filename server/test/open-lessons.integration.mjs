import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import path from 'node:path'
import argon2 from 'argon2'
import { PrismaClient } from '@prisma/client'
import { RoomServiceClient } from 'livekit-server-sdk'

// Point this test at an isolated, migrated database and isolated LiveKit instance.
const databaseUrl = process.env.OPEN_TEST_DATABASE_URL
const livekitUrl = process.env.OPEN_TEST_LIVEKIT_URL
if (!databaseUrl || !livekitUrl) throw new Error('OPEN_TEST_DATABASE_URL and OPEN_TEST_LIVEKIT_URL must point to isolated test services.')
const livekitKey = process.env.OPEN_TEST_LIVEKIT_KEY || 'devkey'
const livekitSecret = process.env.OPEN_TEST_LIVEKIT_SECRET || 'secret'
const frontendRequire = createRequire(path.resolve('../web/package.json'))
const { chromium } = frontendRequire('@playwright/test')
const { io } = frontendRequire('socket.io-client')
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

test('open lesson HTTP, database, Socket.IO and real LiveKit admission', { timeout: 120000 }, async t => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  const livekit = new RoomServiceClient(livekitUrl, livekitKey, livekitSecret)
  const accounts = []; const lessonIds = []; const roomNames = []
  let child, browser, socket, origin
  let serverLog = ''
  const password = 'open-test-password'
  async function api(cookie, endpoint, data, method = data === undefined ? 'GET' : 'POST', headers = {}) {
    const response = await fetch(`${origin}/api/v1${endpoint}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  async function book(cookie, changes = {}) {
    const result = await api(cookie, '/lessons', { title: `Open lesson integration ${randomUUID()}`, startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: null, accessMode: 'OPEN', ...changes })
    assert.equal(result.status, 201)
    lessonIds.push(result.body.id)
    roomNames.push((await db.lesson.findUniqueOrThrow({ where: { id: result.body.id } })).roomName)
    return result.body
  }
  const hasLesson = (response, lesson) => response.body.some(row => row.id === lesson.id)
  const command = (type, lessonId, payload = {}) => new Promise((resolve, reject) => socket.timeout(5000).emit('command', { type, lessonId, payload }, (error, result) => error ? reject(error) : resolve(result)))
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
    for (const role of ['teacher', 'student', 'student', 'teacher']) accounts.push(await db.user.create({ data: { username: `open_test_${randomUUID()}`, name: `Integration ${role}`, role, passwordHash } }))
    const [owner, assigned, outsider, otherTeacher] = accounts
    await db.teacherStudent.create({ data: { teacherId: owner.id, studentId: assigned.id } })
    const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve))
    origin = `http://127.0.0.1:${port}`
    child = spawn(process.execPath, ['dist/main.js'], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), LIVEKIT_URL: livekitUrl, LIVEKIT_PUBLIC_URL: livekitUrl.replace(/^http/, 'ws'), LIVEKIT_API_KEY: livekitKey, LIVEKIT_API_SECRET: livekitSecret, PUBLIC_ORIGIN: origin, PROXY_AUTH_SECRET: 'isolated-open-test-proxy', S3_ENDPOINT: 'http://127.0.0.1:1', S3_ACCESS_KEY: 'unused', S3_SECRET_KEY: 'unused' }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', chunk => { serverLog += chunk }); child.stderr.on('data', chunk => { serverLog += chunk })
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`Isolated API exited: ${serverLog}`)
      try { if ((await api(null, '/auth/me')).status === 401) { ready = true; break } } catch {}
      await delay(100)
    }
    assert.equal(ready, true, serverLog)
    const cookies = []
    for (const account of accounts) { const login = await api(null, '/auth/login', { username: account.username, password }); assert.equal(login.status, 201); cookies.push(login.cookie) }
    const [ownerCookie, assignedCookie, outsiderCookie, otherTeacherCookie] = cookies
    let open, invitationOnly
    await t.test('new visibility persists, legacy default stays private, and discovery respects access', async () => {
      assert.equal((await api(null, '/lessons')).status, 401)
      invitationOnly = await book(ownerCookie, { accessMode: undefined, studentIds: [assigned.id] })
      assert.equal(invitationOnly.accessMode, 'INVITE_ONLY')
      assert.equal((await api(outsiderCookie, `/join/${invitationOnly.code}`)).status, 403)
      assert.equal(hasLesson(await api(outsiderCookie, '/lessons'), invitationOnly), false)
      open = await book(ownerCookie)
      assert.equal(open.accessMode, 'OPEN'); assert.deepEqual(open.students, [])
      for (const cookie of [outsiderCookie, otherTeacherCookie]) { assert.equal(hasLesson(await api(cookie, '/lessons'), open), true); assert.equal((await api(cookie, `/join/${open.code}`)).status, 200) }
      assert.equal((await api(ownerCookie, '/lessons', { title: 'Invalid private', startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: null, studentIds: [] })).status, 400)
      assert.equal((await api(ownerCookie, '/lessons', { title: 'Invalid assigned account', startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: null, accessMode: 'OPEN', studentIds: [outsider.id] })).status, 403)
    })
    await t.test('any signed-in account joins waiting room, with owner-only controls preserved', async () => {
      for (const cookie of [outsiderCookie, otherTeacherCookie]) {
        const waiting = await api(cookie, `/lessons/${open.id}/join`, {})
        assert.equal(waiting.status, 201); assert.equal(waiting.body.waiting, true); assert.equal(waiting.body.token, undefined)
        assert.equal((await api(cookie, `/lessons/${open.id}/cancel`, {})).status, 403)
      }
      const snapshot = await api(otherTeacherCookie, `/lessons/${open.id}/snapshot`)
      assert.equal(snapshot.body.participants.find(row => row.user.id === otherTeacher.id).user.role, 'teacher')
      assert.equal(snapshot.body.lesson.teacher.id, owner.id)
    })
    await t.test('real owner media connection starts class; visiting teacher receives participant admission', async () => {
      const admission = await api(ownerCookie, `/lessons/${open.id}/join`, {})
      assert.equal(admission.status, 201); assert.equal(admission.body.waiting, false)
      browser = await chromium.launch({ headless: true })
      const page = await browser.newPage(); await page.goto(`${origin}/api/v1/auth/me`)
      await page.addScriptTag({ path: path.resolve('../web/node_modules/livekit-client/dist/livekit-client.umd.js') })
      await page.evaluate(async admission => { window.openTestRoom = new LivekitClient.Room(); await window.openTestRoom.connect(admission.livekitUrl, admission.token) }, admission.body)
      const connected = await api(ownerCookie, `/lessons/${open.id}/connected`, {})
      assert.equal(connected.status, 201); assert.equal(connected.body.status, 'LIVE')
      const visitorAdmission = await api(otherTeacherCookie, `/lessons/${open.id}/join`, {})
      assert.equal(visitorAdmission.status, 201); assert.equal(visitorAdmission.body.waiting, false)
      const claims = JSON.parse(Buffer.from(visitorAdmission.body.token.split('.')[1], 'base64url').toString())
      assert.equal(JSON.parse(claims.metadata).role, 'student')
      assert.equal((await api(otherTeacherCookie, `/lessons/${open.id}/end`, {})).status, 403)
      socket = io(origin, { transports: ['websocket'], extraHeaders: { Cookie: otherTeacherCookie, Origin: origin } })
      await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject) })
      const subscription = await new Promise((resolve, reject) => socket.timeout(5000).emit('subscribe', { lessonId: open.id }, (error, result) => error ? reject(error) : resolve(result)))
      assert.equal(subscription.ok, true)
      const chat = await command('chat.send', open.id, { text: 'A visiting teacher joins as a participant.', clientId: randomUUID() })
      assert.equal(chat.ok, true)
      for (const type of ['media.update', 'document.page']) { const denied = await command(type, open.id); assert.equal(denied.ok, false); assert.equal(denied.error.code, 'FORBIDDEN') }
      const kicked = await api(ownerCookie, `/lessons/${open.id}/kick`, { userId: otherTeacher.id }); assert.equal(kicked.status, 201)
      assert.equal((await api(otherTeacherCookie, `/lessons/${open.id}/join`, {})).body.code, 'KICKED')
      const cached = await fetch(`${origin}/internal/livekit-auth`, { headers: { 'x-proxy-secret': 'isolated-open-test-proxy', 'x-forwarded-uri': `/livekit/rtc?access_token=${encodeURIComponent(visitorAdmission.body.token)}` } })
      assert.equal(cached.status, 403)
    })
    await t.test('editing preserves joined members; switching to selected-only revokes outsiders', async () => {
      const scheduled = await book(ownerCookie)
      await api(outsiderCookie, `/lessons/${scheduled.id}/join`, {})
      const edited = await api(ownerCookie, `/lessons/${scheduled.id}`, { title: 'Updated open lesson', startsAt: scheduled.startsAt, endsAt: null, accessMode: 'OPEN' }, 'PATCH')
      assert.equal(edited.status, 200); assert.equal(edited.body.students.some(user => user.id === outsider.id), true)
      const privateEdit = await api(ownerCookie, `/lessons/${scheduled.id}`, { title: 'Selected participants', startsAt: scheduled.startsAt, endsAt: null, accessMode: 'INVITE_ONLY', studentIds: [assigned.id] }, 'PATCH')
      assert.equal(privateEdit.status, 200)
      assert.equal((await api(outsiderCookie, `/join/${scheduled.code}`)).status, 403)
      assert.equal(hasLesson(await api(outsiderCookie, '/lessons'), scheduled), false)
      assert.equal(hasLesson(await api(assignedCookie, '/lessons'), scheduled), true)
    })
    await t.test('closed open lessons disappear from discovery while joined accounts retain history', async () => {
      assert.equal((await api(ownerCookie, `/lessons/${open.id}/end`, {})).status, 201)
      assert.equal(hasLesson(await api(assignedCookie, '/lessons'), open), false)
      assert.equal(hasLesson(await api(outsiderCookie, '/lessons'), open), true)
      assert.equal((await api(outsiderCookie, `/lessons/${open.id}/join`, {})).status, 409)
    })
  } finally {
    socket?.disconnect()
    await browser?.close()
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]); if (child.exitCode === null) child.kill('SIGKILL') }
    for (const roomName of roomNames) await livekit.deleteRoom(roomName).catch(() => {})
    await db.lesson.deleteMany({ where: { id: { in: lessonIds } } })
    await db.user.deleteMany({ where: { id: { in: accounts.map(account => account.id) } } })
    await db.$disconnect()
  }
})
