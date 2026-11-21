import { Body, CanActivate, Controller, Delete, ExecutionContext, Get, Headers, Injectable, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { diskStorage } from 'multer'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { Auth, Database } from './auth'
import { Lessons } from './lessons'
import { Materials } from './materials'
import { ApiError } from './errors'
import { FeaturePolicy } from './features'
import type { CapabilitiesResponse, LoginInput, LessonInput, KickInput, InviteInput } from './generated/contracts'
@Injectable()
class TeacherUploadGuard implements CanActivate {
  constructor(private readonly auth: Auth, private readonly lessons: Lessons) {}
  async canActivate(context: ExecutionContext) { const req = context.switchToHttp().getRequest(); req.user = await this.auth.user(req); this.lessons.teacher(req.user); return true }
}
@ApiTags('service')
@Controller('api/v1')
export class ApiController {
  constructor(readonly auth: Auth, readonly db: Database, readonly lessons: Lessons, readonly materials: Materials, readonly features: FeaturePolicy) {}
  @Get('capabilities')
  capabilities(@Req() req: Request): CapabilitiesResponse { return this.features.capabilities(req.headers) }
  @Get('health')
  @ApiOperation({ summary: 'PostgreSQL, MinIO, LiveKit readiness' })
  async health() {
    try { await this.db.$queryRaw`SELECT 1`; await this.materials.ready(); await this.lessons.livekit.listRooms(); return { status: 'ok', database: true, storage: true, livekit: true } } catch { throw new ApiError('NOT_READY', '서비스를 준비하고 있습니다.', 503) }
  }
  @Get('auth/me') me(@Req() req: Request) { return this.auth.user(req) }
  @Post('auth/login')
  @ApiBody({ schema: { type: 'object', required: ['username','password'], properties: { username: { type: 'string' }, password: { type: 'string', format: 'password' } } } })
  login(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: LoginInput) { return this.auth.login(req, res, body) }
  @Post('auth/logout') logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.auth.logout(req, res) }
  @Get('students') async students(@Req() req: Request) { return this.lessons.roster(await this.auth.user(req)) }
  @Get('lessons') async list(@Req() req: Request) { return this.lessons.list(await this.auth.user(req)) }
  @Post('lessons') async create(@Req() req: Request, @Body() body: LessonInput) { return this.lessons.create(await this.auth.user(req), body) }
  @Get('join/:code') async resolve(@Req() req: Request, @Param('code') code: string) { return this.lessons.resolve(code, await this.auth.user(req)) }
  @Get('lessons/:id') async detail(@Req() req: Request, @Param('id') id: string) { return this.lessons.dto(await this.lessons.access(id, await this.auth.user(req))) }
  @Patch('lessons/:id') async edit(@Req() req: Request, @Param('id') id: string, @Body() body: LessonInput) { return this.lessons.edit(id, await this.auth.user(req), body) }
  @Post('lessons/:id/cancel') async cancel(@Req() req: Request, @Param('id') id: string) { return this.lessons.cancel(id, await this.auth.user(req)) }
  @Post('lessons/:id/join') async join(@Req() req: Request, @Param('id') id: string) {
    return this.lessons.join(id, await this.auth.user(req), this.features.capabilities(req.headers).features['classroom.lesson-modes'] === true)
  }
  @Post('lessons/:id/connected') async connected(@Req() req: Request, @Param('id') id: string) { return this.lessons.connected(id, await this.auth.user(req)) }
  @Post('lessons/:id/leave') async leave(@Req() req: Request, @Param('id') id: string) { return this.lessons.leave(id, await this.auth.user(req)) }
  @Post('lessons/:id/end') async end(@Req() req: Request, @Param('id') id: string) { return this.lessons.end(id, await this.auth.user(req)) }
  @Post('lessons/:id/kick') async kick(@Req() req: Request, @Param('id') id: string, @Body() body: KickInput) { return this.lessons.kick(id, await this.auth.user(req), body) }
  @Post('lessons/:id/invites') async invite(@Req() req: Request, @Param('id') id: string, @Body() body: InviteInput) { return this.lessons.invite(id, await this.auth.user(req), body) }
  @Get('lessons/:id/snapshot') async snapshot(@Req() req: Request, @Param('id') id: string) { return this.lessons.snapshot(id, await this.auth.user(req)) }
  @Get('materials') async files(@Req() req: Request) { return this.materials.list(await this.auth.user(req)) }
  @Post('materials')
  @UseGuards(TeacherUploadGuard)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @UseInterceptors(FileInterceptor('file', { storage: diskStorage({ destination: tmpdir(), filename: (_req, _file, callback) => callback(null, `think-meet-upload-${randomUUID()}`) }), limits: { fileSize: 500 * 1024 * 1024, files: 1, fields: 0 } }))
  async upload(@Req() req: Request, @UploadedFile() file: Express.Multer.File) { return this.materials.upload(await this.auth.user(req), file, req) }
  @Delete('materials/:id') async remove(@Req() req: Request, @Param('id') id: string) { return this.materials.remove(await this.auth.user(req), id) }
  @Get('materials/:id/content') async content(@Req() req: Request, @Res() res: Response, @Param('id') id: string, @Query('lessonId') lessonId?: string) { await this.materials.content(await this.auth.user(req), id, lessonId, req, res) }
  @Post('webhooks/livekit') async webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('authorization') authorization: string) { return this.lessons.webhook(req.rawBody?.toString('utf8') || '', authorization) }
}
@Controller('internal')
export class InternalController {
  constructor(readonly lessons: Lessons) {}
  @Get('livekit-auth') auth(@Headers('x-forwarded-uri') uri: string, @Headers('x-proxy-secret') secret: string, @Headers('authorization') authorization?: string) { return this.lessons.authorizeLivekit(uri || '', secret || '', authorization) }
}
export { TeacherUploadGuard }
