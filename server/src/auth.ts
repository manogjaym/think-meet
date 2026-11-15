import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { parse, serialize } from 'cookie'
import { createHash, randomBytes } from 'node:crypto'
import * as argon2 from 'argon2'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { ApiError } from './errors'
import type { PublicUser } from './types'
@Injectable()
export class Database extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() { await this.$disconnect() }
}
export function publicUser(user: { id: string; username: string; name: string; role: string }): PublicUser {
  return { id: user.id, username: user.username, name: user.name, role: user.role as PublicUser['role'] }
}
export function tokenHash(token: string) { return createHash('sha256').update(token).digest('hex') }
@Injectable()
export class Auth {
  private attempts = new Map<string, { count: number; until: number }>()
  constructor(readonly db: Database) {}
  async userFromCookie(cookie = '') {
    let token: string | undefined
    try { token = parse(cookie).think_meet_session } catch {}
    if (!token) throw new ApiError('UNAUTHENTICATED', '로그인이 필요합니다.', 401)
    const session = await this.db.loginSession.findUnique({ where: { id: tokenHash(token) }, include: { user: true } })
    if (!session || session.expiresAt.getTime() <= Date.now()) throw new ApiError('UNAUTHENTICATED', '로그인이 만료되었습니다.', 401)
    return publicUser(session.user)
  }
  user(req: Request) { return this.userFromCookie(req.headers.cookie) }
  async login(req: Request, res: Response, data: any) {
    const body = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(200) }).parse(data)
    const key = `${req.ip}:${body.username}`
    const hit = this.attempts.get(key)
    if (hit && hit.until > Date.now() && hit.count >= 8) throw new ApiError('RATE_LIMIT', '로그인 시도가 많습니다. 5분 후 다시 시도해 주세요.', 429)
    const user = await this.db.user.findUnique({ where: { username: body.username } })
    if (!user || !(await argon2.verify(user.passwordHash, body.password))) {
      this.attempts.set(key, { count: hit && hit.until > Date.now() ? hit.count + 1 : 1, until: Date.now() + 300000 })
      throw new ApiError('INVALID_CREDENTIALS', '아이디 또는 비밀번호가 올바르지 않습니다.', 401)
    }
    this.attempts.delete(key)
    const token = randomBytes(32).toString('base64url')
    await this.db.loginSession.create({ data: { id: tokenHash(token), userId: user.id, expiresAt: new Date(Date.now() + 12 * 3600000) } })
    res.setHeader('Set-Cookie', serialize('think_meet_session', token, { httpOnly: true, secure: process.env.COOKIE_SECURE !== 'false', sameSite: 'lax', path: '/', maxAge: 12 * 3600 }))
    return publicUser(user)
  }
  async logout(req: Request, res: Response) {
    const token = parse(req.headers.cookie || '').think_meet_session
    if (token) await this.db.loginSession.deleteMany({ where: { id: tokenHash(token) } })
    res.setHeader('Set-Cookie', serialize('think_meet_session', '', { httpOnly: true, secure: process.env.COOKIE_SECURE !== 'false', sameSite: 'lax', path: '/', maxAge: 0 }))
    return { ok: true }
  }
}
