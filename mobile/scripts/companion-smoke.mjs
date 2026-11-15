#!/usr/bin/env node
/**
 * A single disposable browser student for testing the native app against real media.
 * Run from any directory: node mobile/scripts/companion-smoke.mjs
 * Optional: THINK_MEET_ORIGIN=https://... (defaults to the documented local server).
 * Public status/code and a two-page PDF are written to mobile/artifacts, never cookies/tokens.
 * Commands: write {"id":"unique","action":"chat|hand|share-pdf|page|stroke|stop-share|end"}
 * to mobile/artifacts/smoke-command.json. SIGINT/SIGTERM closes only this fixture class.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

const mobileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webDir = path.resolve(mobileDir, '../web')
const requireWeb = createRequire(path.join(webDir, 'package.json'))
const { chromium } = requireWeb('@playwright/test')
const { PDFDocument, StandardFonts, rgb } = requireWeb('pdf-lib')
const origin = (process.env.THINK_MEET_ORIGIN || 'https://192.168.0.64').replace(/\/$/, '')
const artifacts = path.join(mobileDir, 'artifacts')
const commandFile = path.join(artifacts, 'smoke-command.json')
const clientScript = path.join(webDir, 'node_modules/livekit-client/dist/livekit-client.umd.js')
const socketScript = path.join(webDir, 'node_modules/socket.io-client/dist/socket.io.min.js')
let browser, teacher, student, lesson, material, stopping = false
let studentConnected = false
let lastCommand = null
const seenCommands = new Set()

await fs.mkdir(artifacts, { recursive: true })
async function saveJson(name, value) {
  const target = path.join(artifacts, name)
  await fs.writeFile(`${target}.tmp`, JSON.stringify(value, null, 2))
  await fs.rename(`${target}.tmp`, target)
}
async function api(page, endpoint, data, method = data === undefined ? 'GET' : 'POST') {
  return page.evaluate(async ({ endpoint, data, method }) => {
    const response = await fetch(`/api/v1${endpoint}`, {
      method, credentials: 'include',
      ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    })
    const text = await response.text()
    let body; try { body = JSON.parse(text) } catch { body = text }
    if (!response.ok) throw new Error(`${response.status}: ${body.message || 'API request failed'}`)
    return body
  }, { endpoint, data, method })
}
async function makePage(username) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['camera', 'microphone', 'local-network-access'] })
  const page = await context.newPage()
  page.on('console', message => { if (message.type() === 'error') console.error(`Browser: ${message.text().replace(/([?&]access_token=)[^& ]+/g, '$1[redacted]')}`) })
  // An inert same-origin document avoids launching a second copy of the whole web UI.
  await page.route(`${origin}/mobile-smoke-fixture`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><h1>Native app smoke companion</h1></body></html>' }))
  await page.goto(`${origin}/mobile-smoke-fixture`)
  await api(page, '/auth/login', { username, password: 'test123' })
  await page.addScriptTag({ path: socketScript })
  await page.addScriptTag({ path: clientScript })
  return page
}
async function connectSocket(page) {
  const ack = await page.evaluate(lessonId => new Promise((resolve, reject) => {
    const socket = window.smokeSocket = io(window.location.origin, { transports: ['polling', 'websocket'], withCredentials: true })
    socket.once('connect_error', error => reject(new Error(error.message)))
    socket.once('connect', () => socket.timeout(10000).emit('subscribe', { lessonId }, (error, result) => error ? reject(error) : resolve(result)))
    socket.on('snapshot', snapshot => { window.smokeSnapshot = snapshot })
  }), lesson.id)
  if (!ack.ok) throw new Error(ack.error?.message || 'Socket subscription failed')
}
async function command(page, type, payload = {}) {
  const result = await page.evaluate(({ lessonId, type, payload }) => new Promise((resolve, reject) => {
    window.smokeSocket.timeout(10000).emit('command', { lessonId, type, payload, requestId: crypto.randomUUID() }, (error, ack) => error ? reject(error) : resolve(ack))
  }), { lessonId: lesson.id, type, payload })
  if (!result.ok) throw new Error(result.error?.message || 'Command failed')
  return result.snapshot
}
async function makePdf() {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.HelveticaBold)
  for (let index = 1; index <= 2; index++) {
    const page = pdf.addPage([960, 600])
    page.drawRectangle({ x: 0, y: 0, width: 960, height: 600, color: rgb(.96, .97, 1) })
    page.drawRectangle({ x: 0, y: 500, width: 960, height: 100, color: rgb(.32, .23, .98) })
    page.drawText(`THINK MEET - MOBILE TEST ${index}/2`, { x: 48, y: 540, size: 28, font, color: rgb(1, 1, 1) })
    page.drawText(index === 1 ? 'Draw and share your ideas here.' : 'Page synchronization verified.', { x: 48, y: 430, size: 28, font, color: rgb(.05, .15, .24) })
    for (let row = 0; row < 4; row++) page.drawLine({ start: { x: 48, y: 335 - row * 75 }, end: { x: 912, y: 335 - row * 75 }, thickness: 1, color: rgb(.8, .83, .9) })
  }
  const bytes = await pdf.save()
  await fs.writeFile(path.join(artifacts, 'mobile-smoke.pdf'), bytes)
  return bytes
}
async function uploadPdf(bytes) {
  return teacher.evaluate(async bytes => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array(bytes)], 'mobile-smoke.pdf', { type: 'application/pdf' }))
    const response = await fetch('/api/v1/materials', { method: 'POST', credentials: 'include', body: form })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message)
    return result
  }, Array.from(bytes))
}
async function joinStudent() {
  const admission = await api(student, `/lessons/${lesson.id}/join`, {})
  if (admission.waiting) return false
  await student.evaluate(async admission => {
    const room = window.smokeRoom = new LivekitClient.Room({ adaptiveStream: false, dynacast: true, videoCaptureDefaults: { resolution: { width: 640, height: 360 } } })
    room.on(LivekitClient.RoomEvent.TrackSubscribed, track => {
      const element = track.attach()
      element.autoplay = true; element.playsInline = true
      if (track.kind === 'video') element.muted = true
      document.body.appendChild(element)
      void element.play().catch(() => {})
    })
    room.on(LivekitClient.RoomEvent.TrackUnsubscribed, track => track.detach().forEach(element => element.remove()))
    await room.connect(admission.livekitUrl, admission.token)
    await Promise.all([room.localParticipant.setCameraEnabled(true), room.localParticipant.setMicrophoneEnabled(true)])
  }, admission)
  await api(student, `/lessons/${lesson.id}/connected`, {})
  studentConnected = true
  await command(student, 'chat.send', { clientId: randomUUID(), text: '모바일 검증 학생이 연결되었습니다.' })
  return true
}
async function studentMediaStatus() {
  return student.evaluate(async teacherId => {
    const room = window.smokeRoom
    if (!room) return { state: 'waiting', teacherTracks: [] }
    const participant = room.remoteParticipants.get(teacherId)
    const tracks = []
    for (const publication of participant?.trackPublications.values() || []) {
      const samples = []
      const stats = await publication.track?.getRTCStatsReport?.().catch(() => undefined)
      stats?.forEach(item => {
        if (item.type === 'inbound-rtp') samples.push({ kind: item.kind, bytesReceived: item.bytesReceived, packetsReceived: item.packetsReceived, framesDecoded: item.framesDecoded, framesPerSecond: item.framesPerSecond, frameWidth: item.frameWidth, frameHeight: item.frameHeight, totalAudioEnergy: item.totalAudioEnergy })
      })
      tracks.push({ source: publication.source, kind: publication.kind, subscribed: publication.isSubscribed, muted: publication.isMuted, stats: samples })
    }
    return { state: room.state, localCamera: room.localParticipant.isCameraEnabled, localMicrophone: room.localParticipant.isMicrophoneEnabled, teacherTracks: tracks }
  }, lesson.teacher.id)
}
async function status(extra = {}) {
  const snapshot = await api(teacher, `/lessons/${lesson.id}/snapshot`)
  await saveJson('smoke-status.json', {
    at: new Date().toISOString(), lessonId: lesson.id, code: lesson.code, status: snapshot.lesson.status,
    studentConnected, student: await studentMediaStatus(), lastCommand,
    participants: snapshot.participants.map(({ user, online, raised }) => ({ id: user.id, username: user.username, name: user.name, online, raised })),
    messages: snapshot.messages.slice(-10), share: snapshot.share,
    strokes: snapshot.strokes.map(({ id, authorId, page, tool, points, deleted }) => ({ id, authorId, page, tool, pointCount: points.length, deleted })),
    ...extra,
  })
  return snapshot
}
async function runCommand(input) {
  switch (input.action) {
    case 'chat': return command(student, 'chat.send', { clientId: input.id || randomUUID(), text: input.text || '브라우저 학생의 검증 메시지입니다.' })
    case 'hand': return command(student, 'hand.set', { raised: input.raised ?? true })
    case 'share-pdf': return command(teacher, 'share.start', { type: 'document', materialId: material.id })
    case 'page': return command(teacher, 'document.page', { page: input.page || 2 })
    case 'stroke': {
      const snapshot = await api(student, `/lessons/${lesson.id}/snapshot`)
      if (!snapshot.share) throw new Error('Share the PDF before adding a test stroke')
      return command(student, 'stroke.add', { id: randomUUID(), shareId: snapshot.share.id, page: snapshot.share.page, tool: 'pen', color: '#4386d8', points: [{ x: .2, y: .4 }, { x: .5, y: .7 }, { x: .8, y: .4 }] })
    }
    case 'stop-share': return command(teacher, 'share.stop')
    case 'end': stopping = true; return
    default: throw new Error(`Unknown companion action: ${input.action}`)
  }
}
async function cleanup() {
  if (teacher && lesson) {
    const current = await api(teacher, `/lessons/${lesson.id}`).catch(() => null)
    if (current?.status === 'LIVE') await api(teacher, `/lessons/${lesson.id}/end`, {}).catch(() => {})
    else if (current?.status === 'SCHEDULED') await api(teacher, `/lessons/${lesson.id}/cancel`, {}).catch(() => {})
  }
  if (teacher && material) await api(teacher, `/materials/${material.id}`, undefined, 'DELETE').catch(() => {})
  if (teacher && lesson) await status({ stopped: true }).catch(() => {})
  await browser?.close()
}
process.on('SIGINT', () => { stopping = true })
process.on('SIGTERM', () => { stopping = true })

try {
  browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] })
  teacher = await makePage('teacher1')
  student = await makePage('student1')
  lesson = await api(teacher, '/lessons', { title: `모바일 검증 ${new Date().toISOString()}`, description: 'Android/iOS 네이티브 앱과 브라우저 학생의 통합 검증용 수업입니다.', startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: null, accessMode: 'OPEN', studentIds: [] })
  await api(student, `/lessons/${lesson.id}/join`, {})
  await Promise.all([connectSocket(teacher), connectSocket(student)])
  material = await uploadPdf(await makePdf())
  await saveJson('smoke-lesson.json', { id: lesson.id, code: lesson.code, title: lesson.title, joinLink: `${origin}/join/${lesson.code}`, materialId: material.id, pdfPath: path.join(artifacts, 'mobile-smoke.pdf') })
  console.log(JSON.stringify({ ready: true, lessonId: lesson.id, code: lesson.code, joinLink: `${origin}/join/${lesson.code}` }))
  while (!stopping) {
    try {
      const snapshot = await status()
      if (snapshot.lesson.status === 'ENDED' || snapshot.lesson.status === 'CANCELLED') break
      if (!studentConnected && snapshot.lesson.status === 'LIVE') await joinStudent()
      const input = await fs.readFile(commandFile, 'utf8').then(JSON.parse).catch(() => null)
      if (input?.id && !seenCommands.has(input.id)) {
        seenCommands.add(input.id)
        try { await runCommand(input); lastCommand = { id: input.id, action: input.action, ok: true }; await status() }
        catch (error) { lastCommand = { id: input.id, action: input.action, ok: false, message: error.message }; await status() }
      }
    } catch (error) {
      console.error(`Companion: ${error.message}`)
    }
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
} finally { await cleanup() }
