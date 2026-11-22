import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common'
import { ApiBody, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { Auth } from '../auth'
import type { LoginInput } from '../generated/contracts'
import type { PublicUser } from '../types'
import { CurrentUser, Public } from './auth-guard'

@ApiTags('service')
@Controller('api/v1')
export class AuthController {
  constructor(readonly auth: Auth) {}
  @Get('auth/me') me(@CurrentUser() user: PublicUser) { return user }
  @Post('auth/login') @Public()
  @ApiBody({ schema: { type: 'object', required: ['username','password'], properties: { username: { type: 'string' }, password: { type: 'string', format: 'password' } } } })
  login(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: LoginInput) { return this.auth.login(req, res, body) }
  /** Logout clears whatever cookie is present, including an expired one. */
  @Post('auth/logout') @Public()
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.auth.logout(req, res) }
}
