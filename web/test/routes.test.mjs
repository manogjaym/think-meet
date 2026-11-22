import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exceptionType, joinCodeFrom, loginReturnPath, parseRoute, screenPath } from '../src/routes.ts'

const pick = (route, keys = ['page', 'screen', 'lessonId']) => Object.fromEntries(keys.map(key => [key, route[key]]))

test('every app URL maps to one screen and unknown URLs are reported instead of shown as home', () => {
  const cases = [
    ['/', { page: 'screen', screen: 'home', lessonId: undefined }],
    ['/lessons/new', { page: 'screen', screen: 'form', lessonId: undefined }],
    ['/lessons/abc', { page: 'screen', screen: 'detail', lessonId: 'abc' }],
    ['/lessons/abc/edit', { page: 'screen', screen: 'form', lessonId: 'abc' }],
    ...['created', 'prejoin', 'waiting', 'meeting', 'ended'].map(screen => [`/lessons/abc/${screen}`, { page: 'screen', screen, lessonId: 'abc' }]),
    ['/class-notes', { page: 'screen', screen: 'class-notes', lessonId: undefined }],
    ['/students', { page: 'screen', screen: 'students', lessonId: undefined }],
    ['/students/s1/attendance', { page: 'screen', screen: 'attendance', lessonId: undefined }],
    ['/login', { page: 'login', screen: 'home', lessonId: undefined }],
    ['/join/code', { page: 'join', screen: 'home', lessonId: undefined }],
  ]
  for (const [path, expected] of cases) assert.deepEqual(pick(parseRoute(path)), expected, path)
  for (const path of ['/foo', '/lessons/abc/garbage', '/lessons/abc/edit/more', '/students/s1', '/join', '/class-notes/x'])
    assert.equal(parseRoute(path).page, 'unknown', path)
  assert.equal(parseRoute('/students/s%201/attendance').studentId, 's 1')
  assert.equal(parseRoute('/join/a%2Fb').joinCode, 'a/b')
  assert.equal(parseRoute('/error/kicked').exception, 'kicked')
  assert.equal(parseRoute('/error/whatever').exception, 'failed')
  assert.equal(parseRoute('/error/ended', '?lesson=abc').lessonId, 'abc')
  assert.equal(parseRoute('/class-notes', '?tab=records').notesTab, 'records')
})

test('screen navigation targets round-trip through the parser', () => {
  const current = { screen: 'detail', lessonId: 'abc', pathname: '/lessons/abc' }
  assert.deepEqual(screenPath('form', current), { to: '/lessons/abc/edit' })
  assert.deepEqual(screenPath('form', { ...current, screen: 'home' }), { to: '/lessons/new' })
  assert.deepEqual(screenPath('prejoin', current), { to: '/lessons/abc/prejoin', state: { from: '/lessons/abc' } })
  assert.deepEqual(screenPath('exception', current), { to: '/error/failed?lesson=abc' })
  assert.deepEqual(screenPath('meeting', { ...current, lessonId: undefined }), { to: '/' })
  for (const next of ['home', 'students', 'detail', 'created', 'prejoin', 'waiting', 'meeting', 'ended']) {
    const { to } = screenPath(next, current)
    const [pathname, search = ''] = to.split('?')
    assert.equal(parseRoute(pathname, search).screen, next, to)
  }
})

test('login return paths and join links stay on this origin', () => {
  const origin = 'https://class.example'
  assert.equal(loginReturnPath('?next=%2Flessons%2Fabc%3Fx%3D1', origin), '/lessons/abc?x=1')
  assert.equal(loginReturnPath('?next=https%3A%2F%2Fevil.example%2F', origin), '/')
  assert.equal(loginReturnPath('?next=%2Flogin', origin), '/')
  assert.equal(loginReturnPath('', origin), '/')
  assert.equal(joinCodeFrom('abc123', origin), 'abc123')
  assert.equal(joinCodeFrom(`${origin}/join/a%20b`, origin), 'a b')
  assert.throws(() => joinCodeFrom('https://evil.example/join/x', origin), /수업 링크/)
  assert.equal(exceptionType({ code: 'KICKED' }), 'kicked')
  assert.equal(exceptionType('left'), 'failed')
})
