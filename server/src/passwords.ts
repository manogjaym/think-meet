import type { PrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'

export function accountPassword(value: string | undefined, variable: string) {
  if (!value || value.length < 7 || value.length > 200) throw new Error(`${variable} must contain 7 to 200 characters.`)
  return value
}

export async function resetAllUserPasswords(db: PrismaClient, password: string | undefined) {
  const passwordHash = await argon2.hash(accountPassword(password, 'USER_PASSWORD'), { type: argon2.argon2id })
  return db.$transaction(async tx => {
    const users = await tx.user.updateMany({ data: { passwordHash } })
    const sessions = await tx.loginSession.deleteMany({})
    return { users: users.count, sessions: sessions.count }
  })
}
