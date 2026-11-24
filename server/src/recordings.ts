import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, DeleteObjectCommand, HeadObjectCommand, UploadPartCommand } from '@aws-sdk/client-s3'
import type { LessonRecording as StoredRecording } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { Database } from './auth'
import { ApiError } from './errors'
import type { LessonRecording } from './generated/contracts'
import { Lessons } from './lessons'
import { Materials, sendStoredObject } from './materials'
import type { PublicUser } from './types'

/** Every part except the last has exactly this size, so offset / chunk is the S3 part number. */
export const RECORDING_CHUNK_SIZE = 8 * 1024 * 1024
export const RECORDING_MAX_SIZE = 4 * 1024 * 1024 * 1024
export const RECORDING_MAX_DURATION_MS = 8 * 60 * 60 * 1000
export const RECORDING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

const uuid = z.string().uuid()
const createInput = z.object({
  requestId: uuid,
  size: z.number().int().positive().max(RECORDING_MAX_SIZE, '녹화 파일은 4GiB까지 올릴 수 있어요.'),
  durationMs: z.number().int().min(0).max(RECORDING_MAX_DURATION_MS),
  width: z.number().int().min(16).max(4096),
  height: z.number().int().min(16).max(4096),
  startedAt: z.string().datetime({ offset: true }),
})
const offsetInput = z.coerce.number().int().min(0).max(RECORDING_MAX_SIZE)
type Part = { PartNumber: number; ETag: string }
/** The lesson fields the records tab groups and filters by, like class-note captures. */
const withLesson = { lesson: { select: { title: true, startsAt: true, subject: { select: { id: true, name: true } } } } } as const
type Row = StoredRecording & { lesson: { title: string; startsAt: Date; subject: { id: string; name: string } | null } }

const missing = () => new ApiError('NOT_FOUND', '녹화 영상을 찾을 수 없어요.', 404)
const misplaced = () => new ApiError('RECORDING_OFFSET', '업로드 위치가 맞지 않아요. 업로드 상태를 다시 확인해 주세요.', 409)

export function recordingDto(row: Row, owner: PublicUser): LessonRecording {
  const { lesson } = row
  return {
    lesson: { id: row.lessonId, title: lesson.title, startsAt: lesson.startsAt.toISOString(), teacherName: owner.name, ...(lesson.subject ? { subject: lesson.subject } : {}) },
    id: row.id, lessonId: row.lessonId, lessonTitle: row.lesson.title, status: row.status === 'ready' ? 'ready' : 'uploading',
    size: Number(row.size), uploadedBytes: Number(row.uploadedBytes), chunkSize: RECORDING_CHUNK_SIZE,
    durationMs: row.durationMs, width: row.width, height: row.height, startedAt: row.startedAt.toISOString(),
    createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
  }
}

/** Reads one chunk without buffering more than the allowed size. */
export async function readChunk(req: Request, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) throw new ApiError('FILE_TOO_LARGE', '업로드 조각이 너무 커요.', 413)
  const chunks: Buffer[] = []
  let length = 0
  try {
    for await (const chunk of req) {
      length += chunk.length
      if (length > limit) throw new ApiError('FILE_TOO_LARGE', '업로드 조각이 너무 커요.', 413)
      chunks.push(chunk)
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError('UPLOAD_CANCELLED', '업로드가 취소되었습니다.', 499)
  }
  if (req.aborted) throw new ApiError('UPLOAD_CANCELLED', '업로드가 취소되었습니다.', 499)
  return Buffer.concat(chunks, length)
}

@Injectable()
export class Recordings implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout
  constructor(private readonly db: Database, private readonly lessons: Lessons, private readonly materials: Materials) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.removeExpired().catch(error => console.error('recording cleanup failed', error.name)) }, CLEANUP_INTERVAL_MS)
    this.timer.unref()
  }
  onModuleDestroy() { clearInterval(this.timer) }

  private get s3() { return this.materials.s3 }
  private get bucket() { return this.materials.bucket }

  private async own(user: PublicUser, id: unknown) {
    const row = await this.db.lessonRecording.findFirst({ where: { id: uuid.parse(id), teacherId: user.id, expiresAt: { gt: new Date() } }, include: withLesson })
    if (!row) throw missing()
    return row
  }

  /** Starts (or resumes, for the same requestId) a teacher's upload for a lesson they started. */
  async create(user: PublicUser, lessonId: string, body: unknown): Promise<LessonRecording> {
    this.lessons.teacher(user)
    const input = createInput.parse(body)
    const lesson = await this.lessons.get(lessonId)
    if (lesson.teacherId !== user.id) throw missing()
    if (!lesson.startedAt) throw new ApiError('LESSON_NOT_STARTED', '시작한 수업의 녹화만 올릴 수 있어요.', 409)
    return this.lessons.locked(`recording:${user.id}:${input.requestId}`, async () => {
      const existing = await this.db.lessonRecording.findUnique({ where: { teacherId_requestId: { teacherId: user.id, requestId: input.requestId } }, include: withLesson })
      if (existing) {
        if (existing.lessonId !== lesson.id || Number(existing.size) !== input.size) throw new ApiError('CONFLICT', '이미 다른 녹화에 사용한 요청이에요.', 409)
        if (existing.expiresAt <= new Date()) throw missing()
        return recordingDto(existing, user)
      }
      const objectKey = `recordings/${lesson.id}/${randomUUID()}.mp4`
      const { UploadId } = await this.s3.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: objectKey, ContentType: 'video/mp4' }))
      if (!UploadId) throw new Error('Missing multipart upload ID')
      try {
        const now = new Date()
        const row = await this.db.lessonRecording.create({
          data: {
            lessonId: lesson.id, teacherId: user.id, requestId: input.requestId, objectKey, uploadId: UploadId,
            size: BigInt(input.size), durationMs: input.durationMs, width: input.width, height: input.height,
            startedAt: new Date(input.startedAt), createdAt: now, expiresAt: new Date(now.getTime() + RECORDING_RETENTION_MS),
          },
          include: withLesson,
        })
        return recordingDto(row, user)
      } catch (error) {
        await this.s3.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: objectKey, UploadId })).catch(() => {})
        throw error
      }
    })
  }

  /** Accepts the next chunk only at the stored offset; a resent earlier chunk returns the current state. */
  async upload(user: PublicUser, id: string, offsetValue: unknown, req: Request): Promise<LessonRecording> {
    this.lessons.teacher(user)
    const offset = offsetInput.parse(offsetValue)
    // Authorize before reading the body.
    const before = await this.own(user, id)
    if (before.status === 'ready') return recordingDto(before, user)
    const body = await readChunk(req, RECORDING_CHUNK_SIZE)
    return this.lessons.locked(`recording:${before.id}`, async () => {
      const row = await this.own(user, before.id)
      if (row.status === 'ready' || !row.uploadId) return recordingDto(row, user)
      const size = Number(row.size), uploaded = Number(row.uploadedBytes)
      if (offset < uploaded && offset + body.length <= uploaded) return recordingDto(row, user)
      if (offset !== uploaded) throw misplaced()
      if (body.length !== Math.min(RECORDING_CHUNK_SIZE, size - offset)) throw new ApiError('VALIDATION', `업로드 조각 크기가 맞지 않아요. ${RECORDING_CHUNK_SIZE}바이트 단위로 보내 주세요.`)
      if (offset === 0 && body.subarray(4, 8).toString('latin1') !== 'ftyp') throw new ApiError('UNSUPPORTED_FILE', 'MP4 녹화 파일만 올릴 수 있어요.')
      const PartNumber = offset / RECORDING_CHUNK_SIZE + 1
      const { ETag } = await this.s3.send(new UploadPartCommand({ Bucket: this.bucket, Key: row.objectKey, UploadId: row.uploadId, PartNumber, Body: body, ContentLength: body.length }))
      if (!ETag) throw new Error('Missing part ETag')
      const parts = [...(row.parts as Part[]).filter(part => part.PartNumber !== PartNumber), { PartNumber, ETag }].sort((a, b) => a.PartNumber - b.PartNumber)
      const next = offset + body.length
      if (next < size) {
        const updated = await this.db.lessonRecording.update({ where: { id: row.id }, data: { uploadedBytes: BigInt(next), parts }, include: withLesson })
        return recordingDto(updated, user)
      }
      await this.complete(row.objectKey, row.uploadId, parts)
      const updated = await this.db.lessonRecording.update({
        where: { id: row.id }, data: { uploadedBytes: BigInt(size), parts: [], uploadId: null, status: 'ready', completedAt: new Date() },
        include: withLesson,
      })
      return recordingDto(updated, user)
    })
  }

  private async complete(Key: string, UploadId: string, parts: Part[]) {
    try {
      await this.s3.send(new CompleteMultipartUploadCommand({ Bucket: this.bucket, Key, UploadId, MultipartUpload: { Parts: parts } }))
    } catch (error) {
      // A previous request may have completed the upload before its database update was lost.
      if ((error as Error).name !== 'NoSuchUpload') throw error
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key }))
    }
  }

  async list(user: PublicUser, lessonId: unknown): Promise<LessonRecording[]> {
    this.lessons.teacher(user)
    const rows = await this.db.lessonRecording.findMany({
      where: { teacherId: user.id, expiresAt: { gt: new Date() }, ...(lessonId === undefined ? {} : { lessonId: uuid.parse(lessonId) }) },
      include: withLesson,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    })
    return rows.map(row => recordingDto(row, user))
  }

  async content(user: PublicUser, id: string, req: Request, res: Response) {
    const row = await this.own(user, id)
    if (row.status !== 'ready') throw new ApiError('NOT_READY', '업로드가 끝난 뒤 볼 수 있어요.', 409)
    const day = row.startedAt.toISOString().slice(0, 10)
    await sendStoredObject(this.s3, this.bucket, { key: row.objectKey, size: Number(row.size), contentType: 'video/mp4', name: `${row.lesson.title}-${day}.mp4` }, req, res)
  }

  /** Deletes stored media first, then the row, so a failed S3 call is retried on the next run. */
  async removeExpired(now = new Date()) {
    const rows = await this.db.lessonRecording.findMany({ where: { expiresAt: { lte: now } }, take: 100, orderBy: { expiresAt: 'asc' } })
    for (const row of rows) {
      try {
        if (row.uploadId) {
          await this.s3.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: row.objectKey, UploadId: row.uploadId }))
            .catch(error => { if (error.name !== 'NoSuchUpload') throw error })
        }
        // Also removes an object completed by a request whose database update was lost.
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: row.objectKey }))
        await this.db.lessonRecording.deleteMany({ where: { id: row.id, expiresAt: { lte: now } } })
      } catch (error) {
        console.error('recording cleanup failed', row.id, (error as Error).name)
      }
    }
    return rows.length
  }
}
