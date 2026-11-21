import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Track } from 'livekit-client'
import { ScreenShareSession } from '../src/lib/screenShare.ts'

const videoSource = Track.Source.ScreenShare
const audioSource = Track.Source.ScreenShareAudio
const screen = { id: 'first', type: 'screen', ownerId: 'teacher' }
const settle = () => new Promise(resolve => setImmediate(resolve))

class Capture extends EventTarget {
  readyState = 'live'
  end() { this.readyState = 'ended'; this.dispatchEvent(new Event('ended')) }
}

function fixture({ guarded = true } = {}) {
  const tracks = new Map()
  const stops = []
  const errors = []
  const unpublishes = []
  let connected = true
  let share = null
  let picker
  let startAck
  let stopAck
  let starts = 0
  function createTrack(source) {
    const capture = new Capture()
    const track = { mediaStreamTrack: capture, stop() { capture.readyState = 'ended' } }
    tracks.set(source, track)
    session.published(source, track)
    return track
  }
  const localParticipant = {
    async setScreenShareEnabled() { await picker; createTrack(videoSource); createTrack(audioSource) },
    getTrackPublication(source) { return { track: tracks.get(source) } },
    async unpublishTrack(track) {
      unpublishes.push(track)
      for (const [source, value] of tracks) if (value === track) tracks.delete(source)
    },
  }
  const session = new ScreenShareSession({ localParticipant }, 'teacher', {
    connected: () => connected,
    guardedStop: () => guarded,
    async start() { starts++; select(screen); await startAck; return screen },
    async stop(id) {
      stops.push(id)
      await stopAck
      if (id === undefined || share?.id === id) select(null)
    },
    report: error => errors.push(error),
  })
  function select(value) { share = value; session.observeShare(value) }
  return {
    session, tracks, stops, errors, unpublishes, select, createTrack,
    get share() { return share },
    get starts() { return starts },
    set connected(value) { connected = value },
    set picker(value) { picker = value },
    set startAck(value) { startAck = value },
    set stopAck(value) { stopAck = value },
  }
}

test('manual stop releases video and audio without waiting for its server response', async () => {
  const f = fixture()
  f.stopAck = new Promise(() => {})
  await f.session.start('screen')
  const captures = [...f.tracks.values()]
  f.session.stop(screen)
  f.session.stop(screen)
  assert.ok(captures.every(track => track.mediaStreamTrack.readyState === 'ended'))
  assert.deepEqual(f.unpublishes, captures)
  assert.deepEqual(f.stops, [screen.id])
  assert.equal(f.share, screen)
  f.session.close()
})

test('OS end releases audio offline and retries only the original share after resubscription', async () => {
  const f = fixture()
  await f.session.start('browser')
  const audio = f.tracks.get(audioSource).mediaStreamTrack
  f.connected = false
  f.tracks.get(videoSource).mediaStreamTrack.end()
  assert.equal(audio.readyState, 'ended')
  assert.deepEqual(f.stops, [])
  f.connected = true
  f.session.controlReconnected()
  f.session.controlReconnected()
  await settle()
  assert.deepEqual(f.stops, [screen.id])
  assert.equal(f.share, null)
})

test('media reconnect keeps the existing share when video returns and stops a failed republish', async () => {
  const f = fixture()
  await f.session.start('screen')
  const video = f.tracks.get(videoSource)
  const audio = f.tracks.get(audioSource)
  f.tracks.clear()
  assert.equal(video.mediaStreamTrack.readyState, 'live')
  f.tracks.set(videoSource, video)
  f.session.published(videoSource, video)
  f.session.mediaReconnected()
  assert.equal(f.share.id, screen.id)
  assert.equal(f.starts, 1)
  assert.deepEqual(f.stops, [])

  f.tracks.clear()
  f.session.mediaReconnected()
  await settle()
  assert.equal(video.mediaStreamTrack.readyState, 'ended')
  assert.equal(audio.mediaStreamTrack.readyState, 'ended')
  assert.deepEqual(f.stops, [screen.id])
})

test('replacement releases capture and discards a queued stop for the old share', async () => {
  for (const replacement of [{ ...screen, id: 'new-screen' }, { ...screen, id: 'pdf', type: 'document' }]) {
    const f = fixture()
    await f.session.start('screen')
    const tracks = [...f.tracks.values()]
    f.connected = false
    if (replacement.type === 'document') tracks[0].mediaStreamTrack.end()
    f.select(replacement)
    f.connected = true
    f.session.controlReconnected()
    f.session.stop(screen)
    await settle()
    assert.ok(tracks.every(track => track.mediaStreamTrack.readyState === 'ended'))
    assert.deepEqual(f.stops, [])
    assert.equal(f.share, replacement)
  }
})

test('OS end while share.start is in flight stops the ID from the late acknowledgement', async () => {
  const f = fixture()
  let acknowledge
  f.startAck = new Promise(resolve => { acknowledge = resolve })
  const start = f.session.start('screen')
  await settle()
  f.tracks.get(videoSource).mediaStreamTrack.end()
  assert.deepEqual(f.stops, [])
  acknowledge()
  await start
  await settle()
  assert.deepEqual(f.stops, [screen.id])
  assert.equal(f.share, null)
})

test('switching away from classroom mode releases capture from a late OS picker', async () => {
  const f = fixture()
  let chooseSource
  f.picker = new Promise(resolve => { chooseSource = resolve })
  const start = f.session.start('screen')
  f.session.observeShare(null, false)
  chooseSource()
  await start
  await settle()
  assert.equal(f.starts, 0)
  assert.equal(f.tracks.size, 0)
  assert.deepEqual(f.stops, [])
  assert.ok(f.unpublishes.every(track => track.mediaStreamTrack.readyState === 'ended'))
})

test('legacy server receives an explicit stop but never a replayed automatic stop', async () => {
  const f = fixture({ guarded: false })
  await f.session.start('screen')
  f.tracks.get(videoSource).mediaStreamTrack.end()
  f.session.controlReconnected()
  assert.deepEqual(f.stops, [])
  f.session.stop(screen)
  await settle()
  assert.deepEqual(f.stops, [undefined])
})
