import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeAssistance, assistancePoint, currentAssistance, geometryMatchesVideo, matchesAssistancePointer } from '../src/lib/remoteAssistance.ts'

const geometry = { width: 1080, height: 2400, rotation: 0, version: 1 }
const assistance = { id: 'session', teacherId: 'teacher', studentId: 'android-student', status: 'active', expiresAt: null, shareId: 'screen', geometry }
const snapshot = { lessonId: 'lesson', lesson: { status: 'LIVE', teacher: { id: 'teacher' } }, share: { id: 'screen', ownerId: 'android-student', type: 'screen', assistanceId: assistance.id }, assistance }
const frame = { lessonId: 'lesson', sessionId: 'session', shareId: 'screen', geometryVersion: 1, x: .25, y: .75, authorId: 'teacher' }

test('requests expire and pointer sessions require an approved active student screen', () => {
  assert.equal(currentAssistance({ ...assistance, expiresAt: '2026-11-17T00:00:00Z' }, Date.parse('2026-11-17T00:00:00Z')), false)
  assert.equal(currentAssistance({ ...assistance, expiresAt: 'invalid' }), false)
  assert.equal(activeAssistance(snapshot), assistance)
  for (const status of ['pending', 'approved']) assert.equal(activeAssistance({ ...snapshot, assistance: { ...assistance, status } }), null)
  for (const share of [null, { ...snapshot.share, id: 'other' }, { ...snapshot.share, assistanceId: undefined }, { ...snapshot.share, ownerId: 'someone-else' }, { ...snapshot.share, type: 'document' }]) {
    assert.equal(activeAssistance({ ...snapshot, share }), null)
  }
  assert.equal(activeAssistance({ ...snapshot, lesson: { ...snapshot.lesson, status: 'ENDED' } }), null)
  assert.equal(activeAssistance({ ...snapshot, assistance: { ...assistance, teacherId: 'other' } }), null)
})

test('video content geometry must match the captured orientation before accepting clicks', () => {
  assert.equal(geometryMatchesVideo(geometry, 540, 1200), true)
  assert.equal(geometryMatchesVideo(geometry, 1200, 540), false)
  assert.equal(geometryMatchesVideo(geometry, 0, 0), false)
  assert.equal(geometryMatchesVideo(geometry, NaN, 1200), false)
  assert.equal(geometryMatchesVideo(undefined, 540, 1200), false)
  assert.equal(geometryMatchesVideo({ ...geometry, width: 2400, height: 1080, rotation: 90, version: 2 }, 1200, 540), true)
})

test('points map to actual content and ignore letterbox space', () => {
  const rect = { left: 100, top: 200, width: 400, height: 800 }
  assert.deepEqual(assistancePoint(200, 800, rect), { x: .25, y: .75 })
  assert.equal(assistancePoint(50, 800, rect), null)
  assert.equal(assistancePoint(200, 1200, rect), null)
  assert.equal(assistancePoint(100, 200, { ...rect, width: 0 }), null)
})

test('frames for old sessions, shares, rotations and forged teachers cannot be displayed', () => {
  assert.equal(matchesAssistancePointer(frame, snapshot), true)
  for (const patch of [{ lessonId: 'old' }, { sessionId: 'old' }, { shareId: 'old' }, { geometryVersion: 2 }, { authorId: 'student' }, { authorId: undefined }, { x: -1 }, { y: 2 }, { x: NaN }]) {
    assert.equal(matchesAssistancePointer({ ...frame, ...patch }, snapshot), false)
  }
})
