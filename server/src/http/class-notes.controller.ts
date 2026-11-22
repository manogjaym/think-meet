import { Body, Controller, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { diskStorage } from 'multer'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { CLASS_NOTE_IMAGE_LIMIT, ClassNotes, withClassNoteFile } from '../class-notes'
import type { PublicUser } from '../types'
import { CurrentUser } from './auth-guard'

// AuthGuard runs before this interceptor, so an anonymous upload is rejected before the body is read.
const ClassNoteUpload = FileInterceptor('file', {
  storage: diskStorage({ destination: tmpdir(), filename: (_req, _file, callback) => callback(null, `think-meet-note-${randomUUID()}`) }),
  limits: { fileSize: CLASS_NOTE_IMAGE_LIMIT, files: 1, fields: 4, fieldSize: 128, parts: 6 },
})

@ApiTags('service')
@Controller('api/v1')
export class ClassNotesController {
  constructor(readonly notes: ClassNotes) {}
  @Get('class-notes/target') target(@CurrentUser() user: PublicUser) { return this.notes.target(user) }
  @Get('class-notes/worksheets')
  worksheets(@CurrentUser() user: PublicUser, @Query('month') month?: string, @Query('lessonId') lessonId?: string) { return this.notes.worksheets(user, month, lessonId) }
  @Post('class-notes/lessons/:id/worksheets') @UseInterceptors(ClassNoteUpload)
  submit(@CurrentUser() user: PublicUser, @Param('id') id: string, @Body() fields: unknown, @UploadedFile() file?: Express.Multer.File) {
    return withClassNoteFile(file, () => this.notes.submit(user, id, fields, file))
  }
  @Post('class-notes/worksheets/:id/correction') @UseInterceptors(ClassNoteUpload)
  correct(@CurrentUser() user: PublicUser, @Param('id') id: string, @Body() fields: unknown, @UploadedFile() file?: Express.Multer.File) {
    return withClassNoteFile(file, () => this.notes.correct(user, id, fields, file))
  }
  @Get('class-notes/captures') captures(@CurrentUser() user: PublicUser) { return this.notes.captures(user) }
  @Post('class-notes/lessons/:id/captures') @UseInterceptors(ClassNoteUpload)
  capture(@CurrentUser() user: PublicUser, @Param('id') id: string, @Body() fields: unknown, @UploadedFile() file?: Express.Multer.File) {
    return withClassNoteFile(file, () => this.notes.capture(user, id, fields, file))
  }
  @Get('class-notes/images/:id')
  async image(@CurrentUser() user: PublicUser, @Param('id') id: string, @Res() res: Response) { await this.notes.content(user, id, res) }
}
