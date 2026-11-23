import { Injectable } from '@nestjs/common'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { Prisma, type ClassNoteImage as StoredImage, type Lesson } from '@prisma/client'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { open, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import type { Response } from 'express'
import { z } from 'zod'
import { Database } from './auth'
import { ApiError } from './errors'
import type { ClassNoteCapture, ClassNoteImage, ClassNoteLesson, ClassNoteTarget, ClassNoteWorksheet } from './generated/contracts'
import { Lessons } from './lessons'
import { Materials } from './materials'
import type { PublicUser, Share } from './types'
import { readShare } from './lesson/share'

export const CLASS_NOTE_IMAGE_LIMIT = 10 * 1024 * 1024
const run = promisify(execFile)
const uuid = z.string().uuid()
const ordered = [{ createdAt: 'desc' }, { id: 'desc' }] satisfies Prisma.ClassNoteImageOrderByWithRelationInput[]
const captureInput = z.object({ shareId: uuid, admissionId: uuid, page: z.coerce.number().int().positive() })
const unavailable = () => new ApiError('NOT_FOUND', '수업 노트에서 항목을 찾을 수 없어요.', 404)
const changedTarget = () => new ApiError('NOTE_TARGET_CHANGED', '제출할 수업이 바뀌었어요. 대상을 다시 확인해 주세요.', 409)
const changedShare = () => new ApiError('NOTE_SHARE_CHANGED', '공유 자료가 바뀌었어요. 화면을 다시 저장해 주세요.', 409)

function image(row: StoredImage): ClassNoteImage {
  return { id: row.id, createdAt: row.createdAt.toISOString() }
}

export function worksheetMonth(month: unknown) {
  const value = z.string().regex(/^[2-9]\d{3}-(0[1-9]|1[0-2])$/, '제출 월을 확인해 주세요.').parse(month)
  const [year, number] = value.split('-').map(Number)
  return { gte: new Date(Date.UTC(year, number - 1, 1, -9)), lt: new Date(Date.UTC(year, number, 1, -9)) }
}

export async function normalizeClassNoteImage(file: Express.Multer.File | undefined): Promise<Buffer> {
  if (!file?.size) throw new ApiError('INVALID_FILE', '이미지 파일을 선택해 주세요.')
  if (file.size > CLASS_NOTE_IMAGE_LIMIT) throw new ApiError('FILE_TOO_LARGE', '이미지는 10MiB까지 올릴 수 있어요.', 413)
  const header = Buffer.alloc(8)
  const handle = await open(file.path)
  try { await handle.read(header, 0, header.length, 0) } finally { await handle.close() }
  const isPng = header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const isJpeg = header[0] === 255 && header[1] === 216 && header[2] === 255
  if (!isPng && !isJpeg) throw new ApiError('UNSUPPORTED_FILE', 'JPEG 또는 PNG 이미지를 선택해 주세요.')
  try {
    const { stdout } = await run('ffmpeg', [
      '-nostdin', '-v', 'error', '-xerror', '-protocol_whitelist', 'file,pipe',
      '-threads', '1', '-max_pixels', '25000000', '-f', isPng ? 'png_pipe' : 'jpeg_pipe', '-i', file.path,
      '-map_metadata', '-1', '-frames:v', '1', '-filter_threads', '1', '-vf', "scale='min(2560,iw)':'min(2560,ih)':force_original_aspect_ratio=decrease",
      '-c:v', 'mjpeg', '-threads', '1', '-q:v', '2', '-f', 'image2pipe', 'pipe:1',
    ], { encoding: 'buffer', timeout: 10_000, maxBuffer: CLASS_NOTE_IMAGE_LIMIT })
    if (!stdout.length) throw new Error('Empty image')
    return stdout
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error
    throw new ApiError('INVALID_FILE', '이미지를 열 수 없어요. 파일 형식과 크기를 확인해 주세요.')
  }
}

@Injectable()
export class ClassNotes {
  constructor(private readonly db: Database, private readonly lessons: Lessons, private readonly materials: Materials) {}

  private requireStudent(user: PublicUser) {
    if (user.role !== 'student') throw new ApiError('FORBIDDEN', '학생 계정에서 이용할 수 있어요.', 403)
  }

  private async targetFor(userId: string) {
    return this.db.lesson.findFirst({
      where: {
        accessMode: 'INVITE_ONLY', members: { some: { userId, banned: false } },
        OR: [{ status: 'LIVE' }, { status: 'SCHEDULED', startsAt: { gte: new Date() } }],
      },
      orderBy: [{ status: 'asc' }, { startsAt: 'asc' }, { id: 'asc' }],
    })
  }

  private lessonDto(lesson: Lesson, names: Map<string, string>): ClassNoteLesson {
    return { id: lesson.id, title: lesson.title, startsAt: lesson.startsAt.toISOString(), teacherName: names.get(lesson.teacherId) ?? '선생님' }
  }

  private async names(ids: string[]) {
    const users = await this.db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } })
    return new Map(users.map(user => [user.id, user.name]))
  }

  async target(user: PublicUser): Promise<ClassNoteTarget> {
    this.requireStudent(user)
    const lesson = await this.targetFor(user.id)
    return { lesson: lesson ? this.lessonDto(lesson, await this.names([lesson.teacherId])) : null }
  }

  /** Teachers list one of their lessons, or every submission to their lessons in a Seoul month. Students list their own month. */
  async worksheets(user: PublicUser, month: unknown, lessonId: unknown): Promise<ClassNoteWorksheet[]> {
    let filter: Prisma.ClassNoteImageWhereInput
    if (user.role !== 'teacher') {
      this.requireStudent(user)
      filter = { studentId: user.id, createdAt: worksheetMonth(month) }
    } else if (lessonId !== undefined) {
      const id = uuid.parse(lessonId)
      if (!(await this.db.lesson.findFirst({ where: { id, teacherId: user.id } }))) throw unavailable()
      filter = { lessonId: id, lesson: { teacherId: user.id } }
    } else filter = { lesson: { teacherId: user.id }, createdAt: worksheetMonth(month) }
    const rows = await this.db.classNoteImage.findMany({ where: { kind: 'worksheet', ...filter }, include: { lesson: true, correction: true }, orderBy: ordered })
    const names = await this.names(rows.flatMap(row => [row.authorId, row.lesson.teacherId]))
    return rows.map(row => ({
      lesson: this.lessonDto(row.lesson, names), studentName: names.get(row.authorId) ?? '학생',
      original: image(row), correction: row.correction ? image(row.correction) : null,
    }))
  }

  private capturesVisibleTo(user: PublicUser): Prisma.ClassNoteImageWhereInput {
    return { kind: 'capture', OR: [
      { authorId: user.id },
      ...(user.role === 'student' ? [{ studentId: null, lesson: { attendance: { some: { userId: user.id } } } }] : []),
    ] }
  }

  /** Students see their own and their attended teachers' captures; teachers see only the captures they saved. */
  async captures(user: PublicUser): Promise<ClassNoteCapture[]> {
    if (user.role !== 'teacher') this.requireStudent(user)
    const rows = await this.db.classNoteImage.findMany({ where: this.capturesVisibleTo(user), include: { lesson: true }, orderBy: ordered })
    const names = await this.names(rows.map(row => row.lesson.teacherId))
    return rows.map(row => ({ lesson: this.lessonDto(row.lesson, names), image: image(row), source: row.authorId === user.id ? 'self' : 'teacher' }))
  }

  async content(user: PublicUser, id: string, res: Response) {
    const row = await this.db.classNoteImage.findFirst({ where: { id: uuid.parse(id), OR: [
      { kind: { in: ['worksheet', 'correction'] }, OR: [{ studentId: user.id }, { lesson: { teacherId: user.id } }] },
      this.capturesVisibleTo(user),
    ] } })
    if (!row) throw unavailable()
    const object = await this.materials.s3.send(new GetObjectCommand({ Bucket: this.materials.bucket, Key: row.objectKey }))
    res.set({ 'Content-Type': row.contentType, 'Content-Length': String(row.size), 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' })
    await pipeline(object.Body as Readable, res)
  }

  async submit(user: PublicUser, id: string, fields: unknown, file: Express.Multer.File | undefined) {
    this.requireStudent(user)
    const lessonId = uuid.parse(id)
    return this.save(user, fields, file, { kind: 'worksheet', lessonId }, async () => {
      if ((await this.targetFor(user.id))?.id !== lessonId) throw changedTarget()
      return { lessonId, studentId: user.id, kind: 'worksheet' }
    })
  }

  async correct(user: PublicUser, id: string, fields: unknown, file: Express.Multer.File | undefined) {
    this.lessons.teacher(user)
    const originalId = uuid.parse(id)
    return this.save(user, fields, file, { kind: 'correction', originalId }, async () => {
      const original = await this.db.classNoteImage.findFirst({ where: { id: originalId, kind: 'worksheet', lesson: { teacherId: user.id } } })
      if (!original) throw unavailable()
      return { lessonId: original.lessonId, studentId: original.studentId, kind: 'correction', originalId }
    })
  }

  async capture(user: PublicUser, id: string, fields: unknown, file: Express.Multer.File | undefined) {
    const lessonId = uuid.parse(id)
    const input = captureInput.parse(fields)
    return this.save(user, fields, file, { kind: 'capture', lessonId }, async () => {
      const lesson = await this.lessons.access(lessonId, user, true)
      if (user.role !== 'student' && lesson.teacherId !== user.id) throw unavailable()
      const member = lesson.members.find(member => member.userId === user.id && member.online && member.admissionId === input.admissionId)
      if (!member || !(await this.db.attendance.findFirst({ where: { lessonId, userId: user.id, admissionId: input.admissionId, leftAt: null } }))) {
        throw new ApiError('NOT_CONNECTED', '수업에 연결한 뒤 다시 시도해 주세요.', 409)
      }
      const share = readShare(lesson.share)
      // A mirrored student screen may be saved only by that student, and stays private to them.
      const mirrored = Boolean(share?.assistanceId)
      if (!share || (mirrored && (user.role !== 'student' || share.ownerId !== user.id)) || share.id !== input.shareId || share.page !== input.page) throw changedShare()
      return { lessonId, studentId: lesson.teacherId === user.id ? null : user.id, kind: 'capture' }
    })
  }

  private async save(
    user: PublicUser, fields: unknown, file: Express.Multer.File | undefined,
    target: { kind: string; lessonId?: string; originalId?: string },
    authorize: () => Promise<Pick<Prisma.ClassNoteImageUncheckedCreateInput, 'lessonId' | 'studentId' | 'kind' | 'originalId'>>,
  ): Promise<ClassNoteImage> {
    const requestId = z.object({ requestId: uuid }).parse(fields).requestId
    const where = { authorId_requestId: { authorId: user.id, requestId } }
    const receipt = async () => {
      const row = await this.db.classNoteImage.findUnique({ where })
      if (!row) return null
      if (row.kind !== target.kind || (target.lessonId && row.lessonId !== target.lessonId) || (target.originalId && row.originalId !== target.originalId)) {
        throw new ApiError('CONFLICT', '이미 다른 항목에 사용한 요청이에요.', 409)
      }
      return row
    }
    const existing = await receipt()
    if (existing) return image(existing)
    const { lessonId } = await authorize()
    const body = await normalizeClassNoteImage(file)
    const key = `class-notes/${randomUUID()}.jpg`
    let committed = false
    try {
      await this.materials.s3.send(new PutObjectCommand({ Bucket: this.materials.bucket, Key: key, Body: body, ContentType: 'image/jpeg', ContentLength: body.length }))
      return await this.lessons.locked(lessonId, async () => {
        const duplicate = await receipt()
        if (duplicate) return image(duplicate)
        const data = await authorize()
        try {
          const row = await this.db.classNoteImage.create({ data: { ...data, requestId, authorId: user.id, objectKey: key, contentType: 'image/jpeg', size: body.length } })
          committed = true
          return image(row)
        } catch (error) {
          const duplicate = await receipt()
          if (!duplicate) throw error
          committed = duplicate.objectKey === key
          return image(duplicate)
        }
      })
    } finally {
      if (!committed) {
        const registered = await this.db.classNoteImage.findUnique({ where: { objectKey: key } }).catch(() => undefined)
        if (registered === null) await this.materials.s3.send(new DeleteObjectCommand({ Bucket: this.materials.bucket, Key: key })).catch(error => console.error('class note image cleanup failed', error.name))
      }
    }
  }
}

export async function withClassNoteFile<T>(file: Express.Multer.File | undefined, action: () => Promise<T>) {
  try { return await action() } finally { if (file?.path) await unlink(file.path).catch(() => {}) }
}
