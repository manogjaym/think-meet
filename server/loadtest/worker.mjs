import { access, mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const TERMINAL_ERRORS = new Map([
  ['ended', 'ended'], ['cancelled', 'ended'], ['kicked', 'kicked'],
  ['moved', 'replaced'], ['replaced', 'replaced'], ['account', 'denied'], ['invalid', 'denied'],
])

export function numberOption(value, fallback, min, max, name) {
  const number = value === undefined || value === '' ? fallback : Number(value)
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} must be an integer between ${min} and ${max}`)
  return number
}

export function readConfig(env = process.env) {
  const origin = new URL(env.PUBLIC_ORIGIN || '')
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without credentials, paths, or query parameters')
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(env.STUDENT_USERNAME || '')) throw new Error('STUDENT_USERNAME is missing or invalid')
  if (!env.STUDENT_PASSWORD) throw new Error('STUDENT_PASSWORD is required')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.LESSON_ID || '')) throw new Error('LESSON_ID must identify the prepared lesson')
  return {
    origin: origin.origin,
    lessonId: env.LESSON_ID,
    username: env.STUDENT_USERNAME,
    password: env.STUDENT_PASSWORD,
    mediaFile: env.STUDENT_VIDEO || '/media/student.y4m',
    resultsDirectory: env.RESULTS_DIRECTORY || '/results',
    durationSeconds: numberOption(env.TEST_DURATION_SECONDS, 0, 0, 365 * 86400, 'TEST_DURATION_SECONDS'),
    initialDelaySeconds: numberOption(env.START_DELAY_SECONDS, 0, 0, 3600, 'START_DELAY_SECONDS'),
    monitorSeconds: numberOption(env.MONITOR_INTERVAL_SECONDS, 10, 5, 60, 'MONITOR_INTERVAL_SECONDS'),
    publishAudio: env.PUBLISH_AUDIO === 'true',
    churn: env.STUDENT_CHURN === 'true',
    executablePath: env.CHROMIUM_EXECUTABLE_PATH || undefined,
  }
}

export function terminalReason(url, lessonStatus, apiCode) {
  if (apiCode === 'KICKED') return 'kicked'
  if (apiCode === 'ACCOUNT' || apiCode === 'NOT_INVITED' || apiCode === 'INVALID') return 'denied'
  if (apiCode === 'REPLACED' || apiCode === 'SESSION_REPLACED') return 'replaced'
  if (['ENDED', 'CANCELLED'].includes(lessonStatus) || ['ENDED', 'CANCELLED'].includes(apiCode)) return 'ended'
  const route = new URL(url, 'https://invalid.local').pathname
  if (route.startsWith('/error/')) return TERMINAL_ERRORS.get(route.split('/')[2]) || null
  if (/^\/lessons\/[^/]+\/ended\/?$/.test(route)) return 'left'
  return null
}

export function sanitizeMessage(error, secret = '') {
  let message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  if (secret) message = message.split(secret).join('[redacted]')
  return message
    .replace(/(access_token|join_request|authorization|cookie|password)=([^\s&]+)/gi, '$1=[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-token]')
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/g, '$1?[redacted]')
    .slice(0, 600)
}

export async function installMetricsProbe(context) {
  await context.addInitScript(() => {
    const OriginalPeerConnection = window.RTCPeerConnection
    const peers = new Set()
    Object.defineProperty(window, '__thinkMeetLoadPeers', { value: peers, configurable: false })
    window.RTCPeerConnection = new Proxy(OriginalPeerConnection, {
      construct(Target, args) {
        const peer = Reflect.construct(Target, args)
        peers.add(peer)
        return peer
      },
    })
  })
}

async function pageApi(page, endpoint, method = 'GET') {
  return page.evaluate(async ({ endpoint, method }) => {
    const response = await fetch(`/api/v1${endpoint}`, { method, credentials: 'include' })
    const body = await response.json().catch(() => ({}))
    return { status: response.status, body }
  }, { endpoint, method })
}

async function collectMetrics(page, userId) {
  return page.evaluate(async userId => {
    const report = {
      framesEncoded: 0, framesSent: 0, bytesSent: 0, packetsSent: 0,
      framesDecoded: 0, packetsLost: 0, inboundVideoBytes: 0,
      outboundVideoTracks: 0, connectedPeerConnections: 0,
      sourceWidth: null, sourceHeight: null, sourceFramesPerSecond: null,
    }
    for (const peer of window.__thinkMeetLoadPeers || []) {
      if (['connected', 'completed'].includes(peer.iceConnectionState)) report.connectedPeerConnections++
      if (peer.signalingState === 'closed') continue
      try {
        const stats = await peer.getStats()
        stats.forEach(stat => {
          const kind = stat.kind || stat.mediaType
          if (stat.type === 'outbound-rtp' && kind === 'video' && !stat.isRemote) {
            report.outboundVideoTracks++
            report.framesEncoded += stat.framesEncoded || 0
            report.framesSent += stat.framesSent || 0
            report.bytesSent += stat.bytesSent || 0
            report.packetsSent += stat.packetsSent || 0
          }
          if (stat.type === 'inbound-rtp' && kind === 'video') {
            report.framesDecoded += stat.framesDecoded || 0
            report.packetsLost += stat.packetsLost || 0
            report.inboundVideoBytes += stat.bytesReceived || 0
          }
          if (stat.type === 'media-source' && kind === 'video') {
            report.sourceWidth = stat.width || null
            report.sourceHeight = stat.height || null
            report.sourceFramesPerSecond = stat.framesPerSecond || null
          }
        })
      } catch { /* A connection can close between the state check and getStats. */ }
    }
    const selfTile = document.querySelector(`.video-tile[data-participant="${userId}"]`)
    const selfVideo = selfTile?.querySelector('video')
    const visibleVideos = [...document.querySelectorAll('.video-tile video')]
    return {
      ...report,
      connected: document.querySelector('.call-connected')?.textContent?.trim() === '연결됨',
      micEnabled: Boolean(document.querySelector('.call-controls button[aria-label="마이크 끄기"]')),
      cameraEnabled: Boolean(document.querySelector('.call-controls button[aria-label="카메라 끄기"]')),
      localVideoReady: Boolean(selfVideo && selfVideo.readyState >= 2 && selfVideo.videoWidth > 0),
      remoteVideoCount: visibleVideos.filter(video => video !== selfVideo && video.readyState >= 2 && video.videoWidth > 0).length,
      participantTiles: document.querySelectorAll('.video-tile[data-participant]').length,
    }
  }, userId)
}

export async function runWorker(config) {
  const { chromium } = await import('playwright')
  await access(config.mediaFile)
  await mkdir(config.resultsDirectory, { recursive: true })
  const statusPath = path.join(config.resultsDirectory, 'status.json')
  const startedAt = new Date().toISOString()
  const abortController = new AbortController()
  let browser, context, page, userId, authenticated = false, joined = false
  let stopping = false, cleanupPromise, attempt = 0, lastLogAt = 0, previousFrames = 0, joinStartedAt = 0
  let nextChurnAt = null
  let statusWrite = Promise.resolve()
  let status = {
    student: config.username, lessonId: config.lessonId, state: 'starting',
    startedAt, updatedAt: startedAt, attempt: 0, connected: false,
    videoPublishing: false, framesEncoded: 0, bytesSent: 0,
    framesDecoded: 0, remoteVideoCount: 0, participants: 0,
    micEnabled: false, cameraEnabled: false, mediaFile: config.mediaFile,
    lastVideoFrameAt: null, elapsedSeconds: 0,
    churnEnabled: config.churn, rejoinAt: null,
  }
  const publish = async (changes, forceLog = false) => {
    if (stopping && changes.state && !['stopped', 'duration', 'failed', 'ended', 'kicked', 'replaced', 'denied', 'left'].includes(changes.state)) return
    const previousState = status.state
    status = { ...status, ...changes, updatedAt: new Date().toISOString(), elapsedSeconds: Math.floor((Date.now() - Date.parse(startedAt)) / 1000) }
    const temporary = `${statusPath}.${process.pid}.tmp`
    const serialized = `${JSON.stringify(status, null, 2)}\n`
    statusWrite = statusWrite.catch(() => {}).then(async () => {
      await writeFile(temporary, serialized, { mode: 0o644 })
      await rename(temporary, statusPath)
    })
    await statusWrite
    if (forceLog || previousState !== status.state || Date.now() - lastLogAt >= 30000) {
      process.stdout.write(`${JSON.stringify(status)}\n`)
      lastLogAt = Date.now()
    }
  }
  const sleep = milliseconds => new Promise(resolve => {
    if (abortController.signal.aborted) return resolve()
    const complete = () => { clearTimeout(timer); abortController.signal.removeEventListener('abort', complete); resolve() }
    const timer = setTimeout(complete, milliseconds)
    abortController.signal.addEventListener('abort', complete, { once: true })
  })
  const cleanup = reason => {
    if (cleanupPromise) return cleanupPromise
    stopping = true
    abortController.abort()
    cleanupPromise = (async () => {
      // Never remove a replacement connection that now owns this identity.
      if (authenticated && joined && page && !page.isClosed() && !['replaced', 'kicked', 'ended', 'denied', 'left'].includes(reason)) {
        await Promise.race([
          pageApi(page, `/lessons/${config.lessonId}/leave`, 'POST').catch(() => {}),
          new Promise(resolve => setTimeout(resolve, 2500)),
        ])
      }
      await context?.close().catch(() => {})
      await browser?.close().catch(() => {})
      await publish({ state: reason, connected: false, videoPublishing: false, cameraEnabled: false, micEnabled: false, stoppedAt: new Date().toISOString() }, true)
    })()
    return cleanupPromise
  }
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void cleanup('stopped').then(() => process.exit(0)).catch(() => process.exit(1)) })
  const checkDuration = () => config.durationSeconds > 0 && Date.now() - Date.parse(startedAt) >= config.durationSeconds * 1000
  const identifyTerminal = async () => {
    let apiState
    try { apiState = await pageApi(page, `/lessons/${config.lessonId}/snapshot`) } catch { return { terminal: terminalReason(page.url()), snapshot: null } }
    return { terminal: terminalReason(page.url(), apiState.body?.lesson?.status, apiState.body?.code), snapshot: apiState.status === 200 ? apiState.body : null, apiStatus: apiState.status }
  }
  const joinClass = async () => {
    attempt++
    previousFrames = 0
    nextChurnAt = null
    joinStartedAt = Date.now()
    await publish({ state: 'joining', attempt, connected: false, videoPublishing: false, lastError: null, rejoinAt: null })
    // Full navigation refreshes the app's auth state on expired sessions.
    await page.goto(`${config.origin}/lessons/${config.lessonId}/prejoin`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    const login = page.getByRole('button', { name: '로그인', exact: true })
    await Promise.race([
      login.waitFor({ state: 'visible', timeout: 45000 }),
      page.locator('.join-submit').waitFor({ state: 'visible', timeout: 45000 }),
      page.locator('.exception-card').waitFor({ state: 'visible', timeout: 45000 }),
    ])
    if (await login.isVisible()) {
      await page.getByLabel('아이디', { exact: true }).fill(config.username)
      await page.getByLabel('비밀번호', { exact: true }).fill(config.password)
      await login.click()
      await Promise.race([
        page.locator('.join-submit').waitFor({ state: 'visible', timeout: 45000 }),
        page.locator('.exception-card').waitFor({ state: 'visible', timeout: 45000 }),
      ])
    }
    const me = await pageApi(page, '/auth/me')
    if (me.status !== 200 || me.body.username !== config.username) throw new Error('The worker could not authenticate its assigned student account')
    authenticated = true
    userId = me.body.id
    const terminal = await identifyTerminal()
    if (terminal.terminal) return terminal.terminal
    const microphoneOff = page.getByRole('button', { name: '마이크 끄기', exact: true })
    const microphoneOn = page.getByRole('button', { name: '마이크 켜기', exact: true })
    if (!config.publishAudio && await microphoneOff.isVisible()) await microphoneOff.click()
    else if (config.publishAudio && await microphoneOn.isVisible()) await microphoneOn.click()
    const cameraOn = page.getByRole('button', { name: '카메라 켜기', exact: true })
    if (await cameraOn.isVisible()) await cameraOn.click()
    const preview = page.getByLabel('카메라 미리보기', { exact: true })
    await preview.waitFor({ state: 'visible', timeout: 15000 })
    await page.waitForFunction(() => {
      const video = document.querySelector('video[aria-label="카메라 미리보기"]')
      return video && video.readyState >= 2 && video.videoWidth > 0
    }, null, { timeout: 20000 })
    joined = true
    await page.locator('.join-submit').click()
    return null
  }
  const takeChurnBreak = async () => {
    // Use normal personal leave so attendance and LiveKit membership are updated.
    const response = await pageApi(page, `/lessons/${config.lessonId}/leave`, 'POST')
    const terminal = terminalReason(config.origin, null, response.body?.code)
    if (terminal) { await cleanup(terminal); return }
    if (response.status !== 200 && response.status !== 201) throw new Error('Scheduled student leave failed')
    joined = false
    // Unload the meeting and its camera/peer connections, retaining the login cookie.
    await page.goto(config.origin, { waitUntil: 'domcontentloaded', timeout: 45000 })
    const rejoinAt = Date.now() + 60000
    while (!stopping) {
      if (checkDuration()) { await cleanup('duration'); return }
      const current = await identifyTerminal()
      if (current.terminal) { await cleanup(current.terminal); return }
      // Another browser may take over this identity while this worker is away.
      if (current.snapshot?.participants?.some(participant => participant.user.id === userId && participant.online)) {
        await cleanup('replaced'); return
      }
      if (current.apiStatus === 401) throw new Error('Session expired during scheduled absence')
      if (Date.now() >= rejoinAt) return
      await publish({ state: 'churn-away', connected: false, videoPublishing: false, cameraEnabled: false, micEnabled: false, rejoinAt: new Date(rejoinAt).toISOString() })
      await sleep(Math.min(config.monitorSeconds * 1000, rejoinAt - Date.now()))
    }
  }
  try {
    await publish({}, true)
    await sleep(config.initialDelaySeconds * 1000)
    if (stopping) return
    browser = await chromium.launch({
      headless: true,
      executablePath: config.executablePath,
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-video-capture=${config.mediaFile}`,
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
      ],
    })
    context = await browser.newContext({
      baseURL: config.origin,
      permissions: ['camera', 'microphone'],
      viewport: { width: 960, height: 640 },
      ignoreHTTPSErrors: false,
    })
    await installMetricsProbe(context)
    await context.addInitScript(({ origin, publishAudio }) => {
      if (window.location.origin === origin && !window.localStorage.getItem('think-meet.devices')) {
        window.localStorage.setItem('think-meet.devices', JSON.stringify({ mic: publishAudio, cam: true, noise: true, speakerId: 'muted' }))
      }
    }, { origin: config.origin, publishAudio: config.publishAudio })
    page = await context.newPage()
    // Browser console output is intentionally not mirrored: SDK errors can include admission JWTs.
    while (!stopping) {
      if (checkDuration()) { await cleanup('duration'); break }
      try {
        const terminal = await joinClass()
        if (terminal) { await cleanup(terminal); break }
        let failures = 0
        while (!stopping) {
          if (checkDuration()) { await cleanup('duration'); break }
          const current = await identifyTerminal()
          if (current.terminal) { await cleanup(current.terminal); break }
          if (current.apiStatus === 401 || page.url().includes('/login')) throw new Error('Session expired; authenticating again')
          if (page.url().includes('/error/failed')) throw new Error('Media connection requires a new admission')
          const metrics = await collectMetrics(page, userId)
          if (!metrics.connected) nextChurnAt = null
          if (config.churn && metrics.connected) {
            if (nextChurnAt === null) nextChurnAt = Date.now() + 60000
            if (Date.now() >= nextChurnAt) {
              nextChurnAt = Date.now() + 60000
              if (Math.random() < 0.5) {
                await takeChurnBreak()
                break
              }
            }
          }
          const framesGrowing = metrics.framesEncoded > previousFrames
          const videoPublishing = metrics.cameraEnabled && metrics.framesEncoded > 0
          previousFrames = metrics.framesEncoded
          const waiting = page.url().includes('/waiting')
          await publish({
            ...metrics, state: metrics.connected ? 'connected' : waiting ? 'waiting' : 'joining',
            videoPublishing, participants: current.snapshot?.participants?.filter(participant => participant.online).length || metrics.participantTiles,
            ...(framesGrowing ? { lastVideoFrameAt: new Date().toISOString() } : {}),
            lessonStatus: current.snapshot?.lesson?.status || null,
            unlimited: current.snapshot?.lesson?.endsAt === null,
          })
          if (!waiting && !metrics.connected && Date.now() - joinStartedAt > 60000) failures++
          else failures = 0
          if (failures >= 3) throw new Error('Media connection could not recover; requesting a fresh admission')
          await sleep(config.monitorSeconds * 1000)
        }
      } catch (error) {
        if (stopping) break
        const terminal = page && !page.isClosed() ? terminalReason(page.url()) : null
        if (terminal) { await cleanup(terminal); break }
        await publish({ state: 'retrying', connected: false, videoPublishing: false, lastError: sanitizeMessage(error, config.password) }, true)
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5))
        await sleep(delay)
      }
    }
  } catch (error) {
    if (!stopping) await publish({ state: 'failed', lastError: sanitizeMessage(error, config.password) }, true)
    throw error
  } finally {
    if (!cleanupPromise) await cleanup(status.state === 'failed' ? 'failed' : 'stopped')
    else await cleanupPromise
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await runWorker(readConfig()) }
  catch (error) { process.stderr.write(`${JSON.stringify({ state: 'failed', message: sanitizeMessage(error, process.env.STUDENT_PASSWORD) })}\n`); process.exitCode = 1 }
}
