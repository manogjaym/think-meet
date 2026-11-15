import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
const require = createRequire(import.meta.url)
const frontendRequire = createRequire(path.resolve('../web/package.json'))
const { chromium } = frontendRequire('@playwright/test')
const { PDFDocument } = require('pdf-lib')
const base = process.env.BASE_URL || process.env.PUBLIC_ORIGIN
const password = process.env.SEED_PASSWORD
if (!base || !password) throw new Error('Set BASE_URL (or PUBLIC_ORIGIN) and SEED_PASSWORD; node --env-file=../infra/local/.env --test test/api.integration.mjs')
const clientScript = path.resolve('../web/node_modules/livekit-client/dist/livekit-client.umd.js')
const socketScript = path.resolve('../web/node_modules/socket.io-client/dist/socket.io.min.js')
async function api(page, endpoint, data, method = data === undefined ? 'GET' : 'POST', headers = {}) {
  return page.evaluate(async ({ endpoint, data, method, headers }) => {
    const response = await fetch(`/api/v1${endpoint}`, { method, headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
    const text = await response.text()
    let body; try { body = JSON.parse(text) } catch { body = text }
    return { status: response.status, body, headers: Object.fromEntries(response.headers) }
  }, { endpoint, data, method, headers })
}
async function upload(page, name, bytes, type) {
  return page.evaluate(async ({ name, bytes, type }) => {
    const form = new FormData(); form.append('file', new File([new Uint8Array(bytes)], name, { type }))
    const response = await fetch('/api/v1/materials', { method: 'POST', body: form })
    return { status: response.status, body: await response.json() }
  }, { name, bytes: Array.from(bytes), type })
}
async function command(page, lessonId, type, payload = {}) {
  return page.evaluate(({ lessonId, type, payload }) => new Promise((resolve, reject) => {
    window.testSocket.timeout(10000).emit('command', { lessonId, type, payload, requestId: crypto.randomUUID() }, (error, result) => error ? reject(error) : resolve(result))
  }), { lessonId, type, payload })
}
async function connectSocket(page, lessonId) {
  await page.addScriptTag({ path: socketScript })
  return page.evaluate(lessonId => new Promise((resolve, reject) => {
    window.testSocket?.disconnect()
    const socket = window.testSocket = io({ transports: ['websocket'], withCredentials: true })
    socket.once('connect_error', reject)
    socket.once('connect', () => socket.timeout(10000).emit('subscribe', { lessonId }, (error, result) => error ? reject(error) : resolve(result)))
  }), lessonId)
}
test('real HTTPS API, LiveKit admission, MinIO and durable classroom integration', { timeout: 180000 }, async t => {
  const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] })
  const contexts = []
  let teacher, student, outsider, lesson, material, roomConnected = false
  const makePage = async username => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true }); contexts.push(context)
    const page = await context.newPage(); await page.goto(base)
    const response = await api(page, '/auth/login', { username, password }); assert.equal(response.status, 201); assert.equal(response.body.username, username)
    return page
  }
  try {
    teacher = await makePage('teacher1'); student = await makePage('student1'); outsider = await makePage('student4')
    await t.test('readiness and assigned roster', async () => {
      assert.equal((await api(teacher, '/health')).status, 200)
      const roster = await api(teacher, '/students'); assert.equal(roster.status, 200); assert.equal(roster.body.length >= 4, true)
      assert.equal((await api(student, '/students')).status, 403)
      const selected = roster.body.find(user => user.username === 'student1')
      const response = await api(teacher, '/lessons', { title: `API integration ${new Date().toISOString()}`, description: 'Isolated automated integration verification', startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString(), studentIds: [selected.id] })
      assert.equal(response.status, 201); lesson = response.body
    })
    if (!lesson) throw new Error('Class creation failed')
    await t.test('invitation, waiting room, invalid booking and ownership guards', async () => {
      const waiting = await api(student, `/lessons/${lesson.id}/join`, {}); assert.equal(waiting.status, 201); assert.equal(waiting.body.waiting, true); assert.equal(waiting.body.token, undefined)
      assert.equal((await api(outsider, `/join/${lesson.code}`)).status, 403)
      assert.equal((await api(student, `/lessons/${lesson.id}/end`, {})).status, 403)
      assert.equal((await api(teacher, `/lessons/${lesson.id}/connected`, {})).status, 409)
      assert.equal((await api(teacher, '/lessons', { title: 'invalid', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() - 1000).toISOString(), studentIds: [] })).status, 400)
    })
    await t.test('real LiveKit connection starts class, then student admission works', async () => {
      const admission = await api(teacher, `/lessons/${lesson.id}/join`, {}); assert.equal(admission.status, 201); assert.equal(admission.body.waiting, false)
      await teacher.addScriptTag({ path: clientScript })
      await teacher.evaluate(async admission => { window.testRoom = new LivekitClient.Room(); await window.testRoom.connect(admission.livekitUrl, admission.token) }, admission.body)
      roomConnected = true
      const connected = await api(teacher, `/lessons/${lesson.id}/connected`, {}); assert.equal(connected.status, 201); assert.equal(connected.body.status, 'LIVE')
      const studentAdmission = await api(student, `/lessons/${lesson.id}/join`, {}); assert.equal(studentAdmission.status, 201); assert.equal(studentAdmission.body.waiting, false)
      assert.equal((await connectSocket(teacher, lesson.id)).ok, true); assert.equal((await connectSocket(student, lesson.id)).ok, true)
    })
    await t.test('private PDF validation, byte ranges and teacher-only upload', async () => {
      const doc = await PDFDocument.create(); doc.addPage(); doc.addPage(); const bytes = await doc.save()
      assert.equal((await upload(student, 'unauthorized.pdf', bytes, 'application/pdf')).status, 403)
      const result = await upload(teacher, 'integration.pdf', bytes, 'application/pdf'); assert.equal(result.status, 201); assert.equal(result.body.pages, 2); material = result.body
      assert.equal((await upload(teacher, 'spoof.pdf', Buffer.from('not PDF'), 'application/pdf')).status, 400)
      assert.equal((await upload(teacher, 'spoof.mp4', Buffer.from('not MP4'), 'video/mp4')).status, 400)
      const range = await api(teacher, `/materials/${material.id}/content`, undefined, 'GET', { Range: 'bytes=0-3' }); assert.equal(range.status, 206); assert.equal(range.body, '%PDF'); assert.equal(range.headers['content-range'], `bytes 0-3/${bytes.length}`)
      const suffix = await api(teacher, `/materials/${material.id}/content`, undefined, 'GET', { Range: 'bytes=-3' }); assert.equal(suffix.status, 206)
      assert.equal((await api(teacher, `/materials/${material.id}/content`, undefined, 'GET', { Range: 'bytes=999999999-' })).status, 416)
      assert.equal((await api(teacher, `/materials/${material.id}/content`, undefined, 'GET', { Range: 'bytes=0-1,3-4' })).status, 416)
      assert.equal([403,409].includes((await api(student, `/materials/${material.id}/content?lessonId=${lesson.id}`)).status), true)
    })
    await t.test('aborted upload leaves no visible material record', async () => {
      const name = `cancelled-${randomUUID()}.pdf`
      const result = await teacher.evaluate(name => new Promise(resolve => {
        const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/v1/materials')
        xhr.upload.onprogress = event => { if (event.loaded > 0) xhr.abort() }
        xhr.onabort = () => resolve('aborted'); xhr.onerror = () => resolve('failed'); xhr.onload = () => resolve('completed')
        const form = new FormData(); form.append('file', new File([new Uint8Array(32 * 1024 * 1024)], name, { type: 'application/pdf' })); xhr.send(form)
      }), name)
      assert.equal(result, 'aborted')
      await new Promise(resolve => setTimeout(resolve, 500))
      assert.equal((await api(teacher, '/materials')).body.some(file => file.name === name), false)
    })
    if (!roomConnected || !material) throw new Error('Live classroom setup failed')
    await t.test('PDF share authorization, page synchronization and active-delete conflict', async () => {
      assert.equal((await command(student, lesson.id, 'share.start', { type: 'document', materialId: material.id })).ok, false)
      assert.equal((await command(teacher, lesson.id, 'share.start', { type: 'document', materialId: material.id })).ok, true)
      assert.equal((await api(student, `/materials/${material.id}/content?lessonId=${lesson.id}`, undefined, 'GET', { Range: 'bytes=0-3' })).status, 206)
      assert.equal((await command(student, lesson.id, 'document.page', { page: 2 })).ok, false)
      assert.equal((await command(teacher, lesson.id, 'document.page', { page: 2 })).snapshot.share.page, 2)
      assert.equal((await api(teacher, `/materials/${material.id}`, undefined, 'DELETE')).status, 409)
    })
    await t.test('durable own-stroke undo, redo and eraser survive new socket', async () => {
      const snapshot = (await api(teacher, `/lessons/${lesson.id}/snapshot`)).body
      const strokeId = randomUUID(); const shareId = snapshot.share.id
      const stroke = { id: strokeId, shareId, page: 2, tool: 'pen', color: '#4386d8', points: [{ x: .1, y: .1 }, { x: .7, y: .4 }] }
      assert.equal((await command(student, lesson.id, 'stroke.add', stroke)).ok, true)
      assert.equal((await command(student, lesson.id, 'annotation.undo')).snapshot.strokes.find(s => s.id === strokeId).deleted, true)
      await connectSocket(student, lesson.id)
      assert.equal((await command(student, lesson.id, 'annotation.redo')).snapshot.strokes.find(s => s.id === strokeId).deleted, false)
      assert.equal((await command(student, lesson.id, 'stroke.erase', { ids: [strokeId] })).snapshot.strokes.find(s => s.id === strokeId).deleted, true)
      await connectSocket(student, lesson.id)
      assert.equal((await command(student, lesson.id, 'annotation.undo')).snapshot.strokes.find(s => s.id === strokeId).deleted, false)
      assert.equal((await command(student, lesson.id, 'annotation.redo')).snapshot.strokes.find(s => s.id === strokeId).deleted, true)
    })
    await t.test('chat retry is idempotent and hand is shared', async () => {
      const clientId = randomUUID(); const body = { clientId, text: 'Persistent integration message' }
      await command(student, lesson.id, 'chat.send', body); const result = await command(student, lesson.id, 'chat.send', body)
      assert.equal(result.snapshot.messages.filter(message => message.clientId === clientId).length, 1)
      const hand = await command(student, lesson.id, 'hand.set', { raised: true }); assert.equal(hand.snapshot.participants.find(p => p.user.username === 'student1').raised, true)
    })
    await t.test('stop share removes student file access; owned file can then be deleted', async () => {
      assert.equal((await command(teacher, lesson.id, 'share.stop')).ok, true)
      assert.equal((await api(student, `/materials/${material.id}/content?lessonId=${lesson.id}`)).status, 403)
      assert.equal((await api(teacher, `/materials/${material.id}`, undefined, 'DELETE')).status, 200)
      material = undefined
    })
    await t.test('logged-out socket stops receiving classroom snapshots', async () => {
      await student.evaluate(() => { window.revocationEvents = []; window.testSocket.on('snapshot', () => window.revocationEvents.push('snapshot')); window.testSocket.on('room:error', error => window.revocationEvents.push(error.code)) })
      assert.equal((await api(student, '/auth/logout', {})).status, 201)
      assert.equal((await command(teacher, lesson.id, 'hand.set', { raised: false })).ok, true)
      await student.waitForFunction(() => window.revocationEvents.includes('UNAUTHENTICATED'))
      const events = await student.evaluate(() => window.revocationEvents)
      assert.equal(events.includes('snapshot'), false)
      assert.equal((await api(student, '/auth/login', { username: 'student1', password })).status, 201)
    })
    await t.test('teacher ends whole class and late joins are rejected', async () => {
      const end = await api(teacher, `/lessons/${lesson.id}/end`, {}); assert.equal(end.status, 201); assert.equal(end.body.status, 'ENDED'); assert.equal(end.body.attendance.length > 0, true)
      assert.equal((await api(student, `/lessons/${lesson.id}/join`, {})).status, 409)
    })
  } finally {
    if (teacher && lesson) { const current = await api(teacher, `/lessons/${lesson.id}`).catch(() => null); if (current?.body.status === 'LIVE') await api(teacher, `/lessons/${lesson.id}/end`, {}).catch(() => {}); else if (current?.body.status === 'SCHEDULED') await api(teacher, `/lessons/${lesson.id}/cancel`, {}).catch(() => {}) }
    if (teacher && material) await api(teacher, `/materials/${material.id}`, undefined, 'DELETE').catch(() => {})
    for (const context of contexts) await context.close().catch(() => {})
    await browser.close()
  }
})
