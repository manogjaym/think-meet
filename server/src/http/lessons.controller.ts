import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { FeaturePolicy } from '../features'
import { Lessons } from '../lessons'
import type { InviteInput, KickInput, LessonInput } from '../generated/contracts'
import type { PublicUser } from '../types'
import { CurrentUser } from './auth-guard'

@ApiTags('service')
@Controller('api/v1')
export class LessonsController {
  constructor(readonly lessons: Lessons, readonly features: FeaturePolicy) {}
  @Get('subjects') subjects(@CurrentUser() user: PublicUser) { return this.lessons.subjects(user) }
  @Get('lessons') list(@CurrentUser() user: PublicUser) { return this.lessons.list(user) }
  private requiresSubject(req: Request) { return this.features.capabilities(req.headers).features['classroom.subject-storage'] === true }
  @Post('lessons') create(@CurrentUser() user: PublicUser, @Req() req: Request, @Body() body: LessonInput) {
    if (body?.subjectId !== undefined) this.features.assertHttpFeature('classroom.subjects', req.headers)
    return this.lessons.create(user, body, this.requiresSubject(req))
  }
  // Route feature gating (classroom.repeat-schedule) runs in HttpFeatureGuard.
  @Post('lesson-series') createSeries(@CurrentUser() user: PublicUser, @Req() req: Request, @Body() body: unknown) {
    return this.lessons.createSeries(user, body, this.requiresSubject(req))
  }
  @Get('join/:code') resolve(@CurrentUser() user: PublicUser, @Param('code') code: string) { return this.lessons.resolve(code, user) }
  @Get('lessons/:id') async detail(@CurrentUser() user: PublicUser, @Param('id') id: string) { return this.lessons.dto(await this.lessons.access(id, user)) }
  @Patch('lessons/:id') edit(@CurrentUser() user: PublicUser, @Req() req: Request, @Param('id') id: string, @Body() body: LessonInput) {
    if (body?.subjectId !== undefined) this.features.assertHttpFeature('classroom.subjects', req.headers)
    return this.lessons.edit(id, user, body, this.requiresSubject(req))
  }
  @Post('lessons/:id/cancel') cancel(@CurrentUser() user: PublicUser, @Param('id') id: string) { return this.lessons.cancel(id, user) }
  @Post('lessons/:id/join') join(@CurrentUser() user: PublicUser, @Req() req: Request, @Param('id') id: string) {
    return this.lessons.join(id, user, this.features.capabilities(req.headers).features['classroom.lesson-modes'] === true)
  }
  @Get('lessons/:id/prejoin') prejoin(@CurrentUser() user: PublicUser, @Param('id') id: string) { return this.lessons.prejoin(id, user) }
  @Put('lessons/:id/waiting/:clientId') @HttpCode(204)
  async renewPrejoinWait(@CurrentUser() user: PublicUser, @Param('id') id: string, @Param('clientId') clientId: string) { await this.lessons.renewPrejoinWait(id, clientId, user) }
  @Delete('lessons/:id/waiting/:clientId') @HttpCode(204)
  async clearPrejoinWait(@CurrentUser() user: PublicUser, @Param('id') id: string, @Param('clientId') clientId: string) { await this.lessons.clearPrejoinWait(id, clientId, user) }
  @Post('lessons/:id/connected') connected(@CurrentUser() user: PublicUser, @Param('id') id: string) { return this.lessons.connected(id, user) }
  @Post('lessons/:id/leave') leave(@CurrentUser() user: PublicUser, @Param('id') id: string) { return this.lessons.leave(id, user) }
  @Post('lessons/:id/end') end(@CurrentUser() user: PublicUser, @Param('id') id: string) { return this.lessons.end(id, user) }
  // Route feature gating (classroom.subject-switch) runs in HttpFeatureGuard.
  @Post('lessons/:id/subject-switch') switchSubject(@CurrentUser() user: PublicUser, @Param('id') id: string, @Body() body: unknown) { return this.lessons.switchSubject(id, user, body) }
  @Post('lessons/:id/kick') kick(@CurrentUser() user: PublicUser, @Param('id') id: string, @Body() body: KickInput) { return this.lessons.kick(id, user, body) }
  @Post('lessons/:id/invites') invite(@CurrentUser() user: PublicUser, @Param('id') id: string, @Body() body: InviteInput) { return this.lessons.invite(id, user, body) }
  @Get('lessons/:id/snapshot') snapshot(@CurrentUser() user: PublicUser, @Param('id') id: string) { return this.lessons.snapshot(id, user) }
}
