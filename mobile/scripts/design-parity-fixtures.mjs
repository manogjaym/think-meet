#!/usr/bin/env node
// Local design captures only. Authentication stays in memory; the manifest contains IDs/codes only.
import https from 'node:https'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const base = new URL('https://192.168.0.64/api/v1/')
const manifestPath = resolve(root, 'mobile/artifacts/design-parity/fixtures.json')
const title = '디자인 기준 확인'
const roles = ['native', 'web']
const command = process.argv[2] || 'status'
if (!['create', 'status', 'cleanup'].includes(command)) {
  console.error('Usage: node mobile/scripts/design-parity-fixtures.mjs create|status|cleanup')
  process.exit(1)
}
let cookie = ''
let agent

async function request(method, path, body) {
  const data = body === undefined ? undefined : JSON.stringify(body)
  return new Promise((resolveRequest, reject) => {
    const req = https.request(new URL(path, base), {
      method, agent, timeout: 20_000,
      headers: {
        Accept: 'application/json', Origin: base.origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }),
      },
    }, res => {
      const chunks = []
      let size = 0
      res.on('data', chunk => {
        size += chunk.length
        if (size > 2 * 1024 * 1024) req.destroy(new Error('API response exceeded the size limit'))
        else chunks.push(chunk)
      })
      res.on('error', () => reject(new Error('API response interrupted')))
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`API ${method} ${path}: HTTP ${res.statusCode}`))
          return
        }
        const session = (res.headers['set-cookie'] || []).find(value => value.startsWith('think_meet_session='))
        if (session) cookie = session.split(';', 1)[0]
        try { resolveRequest(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
        catch { reject(new Error(`API ${method} ${path}: invalid JSON`)) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('API request timed out')))
    req.on('error', error => reject(new Error(`API connection failed (${error.code || 'request error'})`)))
    req.end(data)
  })
}

async function loadManifest() {
  let value
  try { value = JSON.parse(await readFile(manifestPath, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('Cannot read fixture manifest') }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !roles.includes(key))) throw new Error('Invalid fixture manifest')
  for (const role of roles) {
    const entry = value[role]
    if (entry && (!/^[a-f0-9-]{36}$/i.test(entry.id) || !/^[a-f0-9]{12}$/i.test(entry.code) || Object.keys(entry).some(key => !['id', 'code'].includes(key)))) throw new Error(`Invalid ${role} fixture record`)
  }
  return value
}

async function saveManifest(fixtures) {
  await mkdir(dirname(manifestPath), { recursive: true })
  const temporary = `${manifestPath}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(fixtures, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  await rename(temporary, manifestPath)
}

function verify(lesson, record, user) {
  if (lesson.id !== record.id || lesson.code !== record.code || lesson.teacher?.id !== user.id || lesson.title !== title || lesson.description !== '' || lesson.accessMode !== 'OPEN' || lesson.endsAt !== null || lesson.students?.length !== 0) throw new Error('Fixture ownership/data verification failed; no cleanup performed')
  return lesson
}

async function run() {
  agent = new https.Agent({ ca: await readFile(resolve(root, 'infra/local/certs/think-meet-root.crt')), rejectUnauthorized: true })
  const fixtures = await loadManifest()
  if (command !== 'create' && !Object.keys(fixtures).length) throw new Error('No recorded fixtures; run create first')
  const user = await request('POST', 'auth/login', { username: 'teacher1', password: 'test123' })
  if (user.username !== 'teacher1' || user.role !== 'teacher' || !cookie) throw new Error('Teacher authentication failed')
  const lessons = {}
  for (const role of roles) if (fixtures[role]) lessons[role] = verify(await request('GET', `lessons/${fixtures[role].id}`), fixtures[role], user)

  if (command === 'create') {
    if (Object.values(lessons).some(lesson => ['ENDED', 'CANCELLED'].includes(lesson.status))) {
      throw new Error('Recorded fixtures are finished. Archive mobile/artifacts/design-parity/fixtures.json before creating a fresh pair.')
    }
    const existing = Object.values(lessons)[0]
    const startsAt = existing?.startsAt || new Date(Math.ceil((Date.now() + 15 * 60_000) / 3_600_000) * 3_600_000).toISOString()
    if (roles.some(role => !fixtures[role]) && existing && (existing.status !== 'SCHEDULED' || Date.parse(startsAt) < Date.now())) throw new Error('Partial fixture is no longer scheduled in the future; clean it up before creating another pair')
    const payload = { title, description: '', startsAt, endsAt: null, accessMode: 'OPEN', studentIds: [] }
    for (const role of roles) {
      if (fixtures[role]) continue
      const lesson = await request('POST', 'lessons', payload)
      const record = { id: lesson.id, code: lesson.code }
      verify(lesson, record, user)
      fixtures[role] = record
      // Record each successful create immediately so a later failure cannot orphan it.
      await saveManifest(fixtures)
      lessons[role] = lesson
    }
    if (lessons.native.startsAt !== lessons.web.startsAt) throw new Error('Fixture schedules differ')
    for (const role of roles) verify(await request('GET', `lessons/${fixtures[role].id}`), fixtures[role], user)
  }

  if (command === 'cleanup') {
    // Only manifest records passing the ownership/data checks above can be changed.
    for (const role of roles) {
      const lesson = lessons[role]
      if (!lesson) continue
      if (lesson.status === 'SCHEDULED') await request('POST', `lessons/${lesson.id}/cancel`)
      else if (lesson.status === 'LIVE') await request('POST', `lessons/${lesson.id}/end`)
      else if (!['ENDED', 'CANCELLED'].includes(lesson.status)) throw new Error(`Unsupported fixture status: ${lesson.status}`)
    }
    const result = { verifiedAt: new Date().toISOString(), lessons: {} }
    for (const role of roles) {
      if (!fixtures[role]) continue
      const lesson = verify(await request('GET', `lessons/${fixtures[role].id}`), fixtures[role], user)
      if (!['ENDED', 'CANCELLED'].includes(lesson.status)) throw new Error('Fixture cleanup verification failed')
      result.lessons[role] = { id: lesson.id, status: lesson.status }
    }
    await writeFile(resolve(root, 'mobile/artifacts/design-parity/cleanup.json'), `${JSON.stringify(result, null, 2)}\n`)
  }
  // Keep output safe to paste into capture arguments. No authentication data is emitted.
  console.log(JSON.stringify(fixtures, null, 2))
}

try { await run() }
catch (error) { console.error(error.message); process.exitCode = 1 }
finally {
  if (cookie) { try { await request('POST', 'auth/logout') } catch { console.error('Fixture helper logout failed') } }
  cookie = ''
  agent?.destroy()
}
