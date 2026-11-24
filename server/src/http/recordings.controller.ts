import { Body, Controller, Get, Param, Post, Put, Query, Req, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { Recordings } from '../recordings'
import type { PublicUser } from '../types'
import { CurrentUser } from './auth-guard'

@ApiTags('service')
@Controller('api/v1')
export class RecordingsController {
  constructor(readonly recordings: Recordings) {}
  @Post('lessons/:id/recordings')
  create(@CurrentUser() user: PublicUser, @Param('id') id: string, @Body() body: unknown) { return this.recordings.create(user, id, body) }
  @Get('recordings')
  list(@CurrentUser() user: PublicUser, @Query('lessonId') lessonId?: string) { return this.recordings.list(user, lessonId) }
  // The raw application/octet-stream body is read by the service after ownership is checked.
  @Put('recordings/:id/content')
  upload(@CurrentUser() user: PublicUser, @Param('id') id: string, @Query('offset') offset: string, @Req() req: Request) { return this.recordings.upload(user, id, offset, req) }
  @Get('recordings/:id/content')
  async content(@CurrentUser() user: PublicUser, @Param('id') id: string, @Req() req: Request, @Res() res: Response) { await this.recordings.content(user, id, req, res) }
}
