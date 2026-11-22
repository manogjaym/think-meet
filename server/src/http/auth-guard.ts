import { CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { Auth } from '../auth'
import { ApiError } from '../errors'
import type { PublicUser } from '../types'

const PUBLIC_ROUTE = 'thinkmeet:public'
export type AuthenticatedRequest = Request & { user: PublicUser }

/** Opts a handler or controller out of the global session check. Every other HTTP route requires login. */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true)

/** The session user that AuthGuard resolved for this request. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): PublicUser => {
  const user = context.switchToHttp().getRequest<Partial<AuthenticatedRequest>>().user
  if (!user) throw new ApiError('UNAUTHENTICATED', '로그인이 필요합니다.', 401)
  return user
})

/** Registered before the feature gate, so an anonymous request gets 401 rather than a feature error. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: Auth, private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()])) return true
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>()
    req.user = await this.auth.user(req)
    return true
  }
}

/** Rejects non-teachers before a large upload body is parsed (guards run before interceptors). */
@Injectable()
export class TeacherUploadGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>()
    if (user?.role !== 'teacher') throw new ApiError('FORBIDDEN', '선생님만 이용할 수 있습니다.', 403)
    return true
  }
}
