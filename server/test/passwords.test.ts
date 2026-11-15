import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as argon2 from 'argon2'
import { accountPassword, resetAllUserPasswords } from '../src/passwords'

test('account password validation accepts test123 and bounds every provisioning password to seven through two hundred characters', () => {
  for (const variable of ['SEED_PASSWORD', 'USER_PASSWORD', 'LOAD_TEST_PASSWORD']) {
    assert.equal(accountPassword('test123', variable), 'test123')
    assert.equal(accountPassword('x'.repeat(200), variable).length, 200)
    for (const value of [undefined, '', 'test12', 'x'.repeat(201)]) {
      assert.throws(() => accountPassword(value, variable), new RegExp(`${variable} must contain 7 to 200 characters`))
    }
  }
})

test('reset all changes every account with Argon2id and revokes all login sessions in the same transaction', async () => {
  const users = ['teacher1', 'student1', 'load_student_001'].map(username => ({ username, passwordHash: 'old-hash' }))
  const calls: string[] = []
  let sessions = 4
  const db = {
    $transaction: async (operation: (tx: any) => Promise<unknown>) => {
      calls.push('begin')
      const result = await operation({
        user: { updateMany: async ({ data }: any) => {
          calls.push('users')
          users.forEach(user => { user.passwordHash = data.passwordHash })
          return { count: users.length }
        } },
        loginSession: { deleteMany: async (options: any) => {
          assert.deepEqual(options, {})
          calls.push('sessions')
          const count = sessions; sessions = 0
          return { count }
        } },
      })
      calls.push('commit')
      return result
    },
  }
  assert.deepEqual(await resetAllUserPasswords(db as any, 'test123'), { users: 3, sessions: 4 })
  assert.deepEqual(calls, ['begin', 'users', 'sessions', 'commit'])
  assert.equal(sessions, 0)
  for (const user of users) {
    assert.match(user.passwordHash, /^\$argon2id\$/)
    assert.equal(await argon2.verify(user.passwordHash, 'test123'), true)
    assert.equal(await argon2.verify(user.passwordHash, 'old-password'), false)
  }
})

test('reset all rejects an invalid password before starting a database transaction', async () => {
  await assert.rejects(resetAllUserPasswords({} as any, 'test12'), /USER_PASSWORD must contain 7 to 200 characters/)
})
