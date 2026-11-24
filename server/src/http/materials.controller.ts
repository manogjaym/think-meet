import { Controller, Delete, Get, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { diskStorage } from 'multer'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { FeaturePolicy } from '../features'
import { Materials } from '../materials'
import type { PublicUser } from '../types'
import { CurrentUser, TeacherUploadGuard } from './auth-guard'

const MaterialUpload = FileInterceptor('file', { storage: diskStorage({ destination: tmpdir(), filename: (_req, _file, callback) => callback(null, `think-meet-upload-${randomUUID()}`) }), limits: { fileSize: 500 * 1024 * 1024, files: 1, fields: 0 } })

@ApiTags('service')
@Controller('api/v1')
export class MaterialsController {
  constructor(readonly materials: Materials, readonly features: FeaturePolicy) {}
  private subjectLesson(req: Request, lessonId: string | undefined) {
    if (lessonId !== undefined) this.features.assertHttpFeature('classroom.subject-storage', req.headers)
    return lessonId
  }
  @Get('materials') list(@CurrentUser() user: PublicUser, @Req() req: Request, @Query('lessonId') lessonId?: string) { return this.materials.list(user, this.subjectLesson(req, lessonId)) }
  @Post('materials')
  @UseGuards(TeacherUploadGuard)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @UseInterceptors(MaterialUpload)
  upload(@CurrentUser() user: PublicUser, @Req() req: Request, @UploadedFile() file: Express.Multer.File, @Query('lessonId') lessonId?: string) {
    return this.materials.upload(user, file, req, this.subjectLesson(req, lessonId))
  }
  @Delete('materials/:id') remove(@CurrentUser() user: PublicUser, @Param('id') id: string) { return this.materials.remove(user, id) }
  @Get('materials/:id/content')
  async content(@CurrentUser() user: PublicUser, @Req() req: Request, @Res() res: Response, @Param('id') id: string, @Query('lessonId') lessonId?: string) { await this.materials.content(user, id, lessonId, req, res) }
}
