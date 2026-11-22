import { Controller, Delete, Get, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { diskStorage } from 'multer'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { Materials } from '../materials'
import type { PublicUser } from '../types'
import { CurrentUser, TeacherUploadGuard } from './auth-guard'

const MaterialUpload = FileInterceptor('file', { storage: diskStorage({ destination: tmpdir(), filename: (_req, _file, callback) => callback(null, `think-meet-upload-${randomUUID()}`) }), limits: { fileSize: 500 * 1024 * 1024, files: 1, fields: 0 } })

@ApiTags('service')
@Controller('api/v1')
export class MaterialsController {
  constructor(readonly materials: Materials) {}
  @Get('materials') list(@CurrentUser() user: PublicUser) { return this.materials.list(user) }
  @Post('materials')
  @UseGuards(TeacherUploadGuard)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @UseInterceptors(MaterialUpload)
  upload(@CurrentUser() user: PublicUser, @Req() req: Request, @UploadedFile() file: Express.Multer.File) { return this.materials.upload(user, file, req) }
  @Delete('materials/:id') remove(@CurrentUser() user: PublicUser, @Param('id') id: string) { return this.materials.remove(user, id) }
  @Get('materials/:id/content')
  async content(@CurrentUser() user: PublicUser, @Req() req: Request, @Res() res: Response, @Param('id') id: string, @Query('lessonId') lessonId?: string) { await this.materials.content(user, id, lessonId, req, res) }
}
