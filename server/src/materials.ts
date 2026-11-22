import { Injectable } from '@nestjs/common'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { Readable } from 'node:stream'
import type { Request, Response } from 'express'
import { PDFDocument } from 'pdf-lib'
import { Database } from './auth'
import { Lessons } from './lessons'
import { ApiError } from './errors'
import type { PublicUser, Share } from './types'
import { readShare } from './lesson/share'
const run = promisify(execFile)
@Injectable()
export class Materials {
  readonly s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION || 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY || '', secretAccessKey: process.env.S3_SECRET_KEY || '' } })
  readonly bucket = process.env.S3_BUCKET || 'think-meet'
  constructor(readonly db: Database, readonly lessons: Lessons) {}
  async ready() { await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket })); return true }
  async list(user: PublicUser) { this.lessons.teacher(user); return (await this.db.material.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: 'desc' } })).map(material => this.lessons.materialDto(material)) }
  async upload(user: PublicUser, file: Express.Multer.File | undefined, req: Request) {
    let objectKey: string | undefined
    let saved = false
    try {
      this.lessons.teacher(user)
      if (!file) throw new ApiError('VALIDATION', '업로드할 파일을 선택해 주세요.')
      let name = file.originalname
      // multipart filenames are commonly decoded as latin1 by busboy.
      if (!/[\u0080-\u00ff]/.test(name)) name = file.originalname
      else { const utf8 = Buffer.from(name, 'latin1').toString('utf8'); if (!utf8.includes('\ufffd')) name = utf8 }
      name = name.replace(/[\x00-\x1f\x7f\/\\]/g, '_').slice(0, 240)
      const extension = name.toLowerCase().split('.').pop()
      let kind: 'media' | 'document', contentType: string, duration: number | undefined, pages: number | undefined
      if (extension === 'pdf') {
        if (file.size > 50 * 1024 * 1024) throw new ApiError('FILE_TOO_LARGE', 'PDF는 50MiB까지 업로드할 수 있습니다.', 413)
        const bytes = await fs.readFile(file.path)
        if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new ApiError('INVALID_FILE', '유효한 PDF 파일이 아닙니다.')
        let pdf: PDFDocument
        try { pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false }) } catch { throw new ApiError('INVALID_FILE', '암호화되었거나 손상된 PDF는 사용할 수 없습니다.') }
        pages = pdf.getPageCount()
        if (!pages) throw new ApiError('INVALID_FILE', '문서에 페이지가 없습니다.')
        kind = 'document'; contentType = 'application/pdf'
      } else if (extension === 'mp4') {
        if (file.size > 500 * 1024 * 1024) throw new ApiError('FILE_TOO_LARGE', 'MP4는 500MiB까지 업로드할 수 있습니다.', 413)
        let info: any
        try { const output = await run('ffprobe', ['-v','error','-protocol_whitelist','file,pipe','-f','mov','-show_streams','-show_format','-of','json', file.path], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 }); info = JSON.parse(output.stdout) } catch { throw new ApiError('INVALID_FILE', '손상되었거나 지원하지 않는 영상입니다.') }
        const video = info.streams?.find((stream: any) => stream.codec_type === 'video')
        const audio = info.streams?.filter((stream: any) => stream.codec_type === 'audio') || []
        if (!video || video.codec_name !== 'h264' || audio.some((stream: any) => stream.codec_name !== 'aac') || !String(info.format?.format_name || '').split(',').includes('mp4')) throw new ApiError('UNSUPPORTED_CODEC', 'H.264 영상과 AAC 오디오로 인코딩한 MP4만 사용할 수 있습니다.')
        duration = Number(info.format.duration)
        if (!Number.isFinite(duration) || duration <= 0) throw new ApiError('INVALID_FILE', '영상 길이를 확인할 수 없습니다.')
        kind = 'media'; contentType = 'video/mp4'
      } else throw new ApiError('UNSUPPORTED_FILE', 'PDF와 MP4 파일만 업로드할 수 있습니다.')
      if (req.aborted || req.res?.destroyed) throw new ApiError('UPLOAD_CANCELLED', '업로드가 취소되었습니다.', 499)
      objectKey = `${user.id}/${randomUUID()}.${extension}`
      const controller = new AbortController()
      const abort = () => { if (!req.res?.writableEnded) controller.abort() }
      req.res?.once('close', abort)
      try {
        await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, Body: createReadStream(file.path), ContentLength: file.size, ContentType: contentType }), { abortSignal: controller.signal })
      } finally { req.res?.removeListener('close', abort) }
      if (req.aborted || req.res?.destroyed) throw new ApiError('UPLOAD_CANCELLED', '업로드가 취소되었습니다.', 499)
      const material = await this.db.material.create({ data: { ownerId: user.id, name, objectKey, size: file.size, kind, contentType, duration, pages } })
      if (req.aborted || req.res?.destroyed) {
        await this.db.material.delete({ where: { id: material.id } })
        throw new ApiError('UPLOAD_CANCELLED', '업로드가 취소되었습니다.', 499)
      }
      saved = true
      return this.lessons.materialDto(material)
    } finally {
      if (file?.path) await fs.unlink(file.path).catch(() => {})
      if (objectKey && !saved) await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey })).catch(() => {})
    }
  }
  async remove(user: PublicUser, id: string) {
    this.lessons.teacher(user)
    return this.lessons.locked(`material:${id}`, async () => {
      const material = await this.db.material.findUnique({ where: { id } })
      if (!material || material.ownerId !== user.id) throw new ApiError('NOT_FOUND', '파일을 찾을 수 없습니다.', 404)
      const active = await this.db.lesson.findFirst({ where: { status: 'LIVE', share: { path: ['materialId'], equals: id } } })
      if (active) throw new ApiError('MATERIAL_IN_USE', '공유를 중지한 후 파일을 삭제해 주세요.', 409)
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: material.objectKey }))
      await this.db.material.delete({ where: { id } })
      return { ok: true }
    })
  }

  async content(user: PublicUser, id: string, lessonId: string | undefined, req: Request, res: Response) {
    const material = await this.db.material.findUnique({ where: { id } })
    if (!material) throw new ApiError('NOT_FOUND', '파일을 찾을 수 없습니다.', 404)
    if (material.ownerId !== user.id) {
      if (!lessonId) throw new ApiError('FORBIDDEN', '수업에 참여해야 파일을 볼 수 있습니다.', 403)
      const lesson = await this.lessons.access(lessonId, user, true)
      if (readShare(lesson.share)?.materialId !== id) throw new ApiError('FORBIDDEN', '현재 공유 중인 파일만 열 수 있습니다.', 403)
    }
    let range: string | undefined
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
      if (!match || (!match[1] && !match[2])) { res.setHeader('Content-Range', `bytes */${material.size}`); return res.status(416).end() }
      let start = match[1] ? Number(match[1]) : Math.max(0, material.size - Number(match[2]))
      let end = match[1] && match[2] ? Number(match[2]) : material.size - 1
      end = Math.min(end, material.size - 1)
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= material.size || end < start) { res.setHeader('Content-Range', `bytes */${material.size}`); return res.status(416).end() }
      range = `bytes=${start}-${end}`
    }
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: material.objectKey, Range: range }))
    res.status(range ? 206 : 200)
    res.setHeader('Content-Type', material.contentType)
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(material.name)}`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (object.ContentLength !== undefined) res.setHeader('Content-Length', object.ContentLength)
    if (object.ContentRange) res.setHeader('Content-Range', object.ContentRange)
    const stream = object.Body as Readable
    res.once('close', () => stream.destroy())
    stream.once('error', () => { if (!res.headersSent) res.status(502); res.end() })
    stream.pipe(res)
  }
}
