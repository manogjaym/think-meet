import test from 'node:test'
import assert from 'node:assert/strict'
import { readConfig, terminalReason, sanitizeMessage } from './worker.mjs'
const valid = { PUBLIC_ORIGIN: 'https://192.168.0.64', LESSON_ID: '0ec9d377-6749-4077-9308-ae1fb0a92e0a', STUDENT_USERNAME: 'load_student_001', STUDENT_PASSWORD: 'test123' }

test('indefinite student workers default to camera fixture and no microphone', () => {
  const config = readConfig(valid)
  assert.equal(config.durationSeconds, 0)
  assert.equal(config.publishAudio, false)
  assert.equal(config.mediaFile, '/media/student.y4m')
  assert.equal(config.origin, 'https://192.168.0.64')
  assert.equal(config.churn, false)
})
test('random leave and rejoin mode is opt-in', () => {
  assert.equal(readConfig({ ...valid, STUDENT_CHURN: 'true' }).churn, true)
  assert.equal(readConfig({ ...valid, STUDENT_CHURN: 'false' }).churn, false)
})
test('worker configuration rejects invalid targets and durations', () => {
  assert.throws(() => readConfig({ ...valid, PUBLIC_ORIGIN: 'https://user:secret@example.com' }))
  assert.throws(() => readConfig({ ...valid, PUBLIC_ORIGIN: 'http://example.com' }))
  assert.throws(() => readConfig({ ...valid, PUBLIC_ORIGIN: 'https://example.com/api' }))
  assert.throws(() => readConfig({ ...valid, TEST_DURATION_SECONDS: '-1' }))
  assert.throws(() => readConfig({ ...valid, LESSON_ID: 'not-a-lesson' }))
  assert.throws(() => readConfig({ ...valid, STUDENT_USERNAME: '../invalid' }))
})
test('teacher end, kick, revocation and replacement prevent automatic re-entry', () => {
  assert.equal(terminalReason('https://test/lessons/id/meeting', 'ENDED'), 'ended')
  assert.equal(terminalReason('https://test/lessons/id/meeting', 'CANCELLED'), 'ended')
  assert.equal(terminalReason('https://test/error/kicked'), 'kicked')
  assert.equal(terminalReason('https://test/error/moved'), 'replaced')
  assert.equal(terminalReason('https://test/error/account'), 'denied')
  assert.equal(terminalReason('https://test/lessons/id/meeting', 'LIVE', 'KICKED'), 'kicked')
  assert.equal(terminalReason('https://test/lessons/id/meeting', 'LIVE', 'ACCOUNT'), 'denied')
  assert.equal(terminalReason('https://test/lessons/id/ended'), 'left')
})
test('temporary connection errors remain retryable and logs redact credentials', () => {
  assert.equal(terminalReason('https://test/error/failed', 'LIVE'), null)
  const message = sanitizeMessage(new Error(`${valid.STUDENT_PASSWORD} https://test/rtc?access_token=TOKEN&join_request=DATA eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl`), valid.STUDENT_PASSWORD)
  assert.equal(message.includes(valid.STUDENT_PASSWORD), false)
  assert.equal(message.includes('TOKEN'), false)
  assert.equal(message.includes('DATA'), false)
  assert.equal(message.includes('eyJhbGci'), false)
})
