import { Prisma, type LessonInstructionPhase } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AssistanceCommandContext } from '../assistance'
import type { Database } from '../auth'
import { ApiError } from '../errors'
import type { CommandType } from '../generated/contracts'
import type { Lessons } from '../lessons'
import type { Command, PublicUser, Share } from '../types'
import { annotationClear, annotationHistory, strokeAdd, strokeErase } from './annotations'
import { assistanceCommand } from './assistance-commands'
import type { MeetingSnapshotDto } from './dto'
import { shareValue } from './share'

/** Everything a command handler may use; built once per command inside the lesson lock. */
export type CommandContext = {
  lessons: Lessons
  db: Database
  user: PublicUser
  lesson: any
  share: Share | null
  command: Command
  payload: unknown
  assistanceContext?: AssistanceCommandContext
  requireShare(): Share
  requireTeacher(): void
  writeShare(next: Share | null): Promise<unknown>
}
/** `undefined` means "state changed, broadcast"; a snapshot is returned unchanged (a no-op). */
type CommandHandler = (ctx: CommandContext) => Promise<MeetingSnapshotDto | undefined | void>

const participantControl = z.object({ userId: z.uuid(), microphone: z.boolean().optional(), camera: z.boolean().optional(), annotation: z.boolean().optional() })
  .refine(body => body.microphone !== undefined || body.camera !== undefined || body.annotation !== undefined, '바꿀 항목을 선택해 주세요.')
export type ParticipantControl = z.infer<typeof participantControl>
export function parseParticipantControl(payload: unknown) { return participantControl.parse(payload) }

const lessonModeSchema = z.enum(['classroom', 'mirroring'])
const lessonModeChange = z.object({ mode: lessonModeSchema, expectedMode: lessonModeSchema, expectedShareId: z.uuid().nullable(), expectedAssistanceId: z.uuid().nullable() })

function requireConnectedTeacher({ lesson, user, requireTeacher }: CommandContext) {
  requireTeacher()
  if (!lesson.members.some((member: any) => member.userId === user.id && member.online && member.admissionId)) throw new ApiError('NOT_CONNECTED', '화상미팅에 연결한 후 다시 시도해 주세요.', 409)
}
function requirePhase(lesson: any): LessonInstructionPhase {
  if (!lesson.instructionPhase) throw new ApiError('FEATURE_UNAVAILABLE', '이 화상미팅에서는 수업 모드를 사용할 수 없어요.', 409)
  return lesson.instructionPhase
}
/** Writes a lesson-mode change only if the phase is still the one the command validated. */
async function writePhase(db: Database, id: string, expected: LessonInstructionPhase, data: Prisma.LessonUpdateManyMutationInput) {
  const { count } = await db.lesson.updateMany({ where: { id, instructionPhase: expected }, data })
  if (!count) throw new ApiError('LESSON_MODE_CHANGED', '공유 또는 요청 상태가 달라졌어요. 최신 상태를 확인한 뒤 다시 시도해 주세요.', 409)
}
async function ownMaterial(ctx: CommandContext, materialId: string | undefined, kind: string, message: string) {
  const material = materialId ? await ctx.db.material.findUnique({ where: { id: materialId } }) : null
  if (!material || material.ownerId !== ctx.user.id || material.kind !== kind) throw new ApiError('INVALID_MATERIAL', message, 404)
  return material
}

const assistance: CommandHandler = async ctx => {
  const phase = ctx.lesson.instructionPhase
  if (ctx.command.type !== 'assistance.stop' && phase && phase !== 'mirroring') throw new ApiError('LESSON_MODE_REQUIRED', '미러링 모드에서 학생 화면 보기를 사용할 수 있어요.', 409)
  await assistanceCommand(ctx)
}

/** One handler per contract command; the CommandType key set is checked at compile time. */
export const COMMAND_HANDLERS = {
  'lesson.start': async ctx => {
    requireConnectedTeacher(ctx)
    const phase = requirePhase(ctx.lesson)
    if (phase !== 'preparing') return ctx.lessons.snapshotUnlocked(ctx.lesson.id)
    await writePhase(ctx.db, ctx.lesson.id, phase, { instructionPhase: 'classroom', instructionStartedAt: new Date() })
  },
  'lesson.mode.set': async ctx => {
    requireConnectedTeacher(ctx)
    const phase = requirePhase(ctx.lesson)
    if (phase === 'preparing') throw new ApiError('LESSON_NOT_STARTED', '먼저 수업을 시작해 주세요.', 409)
    const next = lessonModeChange.parse(ctx.payload)
    if (phase === next.mode) return ctx.lessons.snapshotUnlocked(ctx.lesson.id)
    const current = ctx.lessons.assistance.current(ctx.lesson.id)
    if (phase !== next.expectedMode || (ctx.share?.id ?? null) !== next.expectedShareId || (current?.id ?? null) !== next.expectedAssistanceId) {
      throw new ApiError('LESSON_MODE_CHANGED', '공유 또는 요청 상태가 달라졌어요. 최신 상태를 확인한 뒤 다시 시도해 주세요.', 409)
    }
    await writePhase(ctx.db, ctx.lesson.id, phase, { instructionPhase: next.mode, share: Prisma.DbNull })
    ctx.lessons.assistance.remove(ctx.lesson.id)
  },
  'chat.send': async ({ db, lesson, user, payload }) => {
    const body = z.object({ text: z.string().trim().min(1).max(2000), clientId: z.string().min(1).max(100) }).parse(payload)
    await db.message.upsert({ where: { lessonId_userId_clientId: { lessonId: lesson.id, userId: user.id, clientId: body.clientId } }, create: { lessonId: lesson.id, userId: user.id, userName: user.name, ...body }, update: {} })
  },
  'hand.set': async ({ db, lesson, user, payload }) => {
    const { raised } = z.object({ raised: z.boolean() }).parse(payload)
    await db.lessonMember.update({ where: { lessonId_userId: { lessonId: lesson.id, userId: user.id } }, data: { raised } })
  },
  'share.start': async ctx => {
    const { lesson, user, payload, requireTeacher, writeShare } = ctx
    if (lesson.instructionPhase) {
      requireTeacher()
      if (lesson.instructionPhase !== 'classroom') throw new ApiError('LESSON_MODE_REQUIRED', '수업방 모드에서 화면 또는 자료를 공유할 수 있어요.', 409)
    }
    const body = z.object({ type: z.enum(['screen','media','document']), materialId: z.string().uuid().optional() }).parse(payload)
    if (body.type === 'screen') {
      await writeShare({ id: randomUUID(), type: 'screen', ownerId: user.id, page: 1, playing: false, position: 0, updatedAt: new Date().toISOString() })
    } else {
      requireTeacher()
      await ctx.lessons.locked(`material:${body.materialId}`, async () => {
        const material = await ownMaterial(ctx, body.materialId, body.type, '공유할 자료를 찾을 수 없습니다.')
        await writeShare({ id: randomUUID(), type: body.type, ownerId: user.id, materialId: material.id, material: ctx.lessons.materialDto(material), page: 1, playing: false, position: 0, updatedAt: new Date().toISOString() })
      })
    }
    ctx.lessons.assistance.remove(lesson.id)
  },
  'document.open': async ctx => {
    requireConnectedTeacher(ctx)
    const { lesson, share, user, writeShare } = ctx
    if (lesson.instructionPhase && lesson.instructionPhase !== 'classroom') throw new ApiError('LESSON_MODE_REQUIRED', '수업방 모드에서 교재를 불러올 수 있어요.', 409)
    const { materialId, page } = z.object({ materialId: z.string().uuid(), page: z.number().int().min(1) }).parse(ctx.payload)
    await ctx.lessons.locked(`material:${materialId}`, async () => {
      const material = await ownMaterial(ctx, materialId, 'document', '공유할 교재를 찾을 수 없습니다.')
      if (page > (material.pages || 1)) throw new ApiError('VALIDATION', '문서 페이지를 확인해 주세요.')
      const updatedAt = new Date().toISOString()
      if (share?.type === 'document' && share.materialId === materialId) {
        if (share.page !== page) await writeShare({ ...share, page, updatedAt })
      } else {
        await writeShare({ id: randomUUID(), type: 'document', ownerId: user.id, materialId, material: ctx.lessons.materialDto(material), page, playing: false, position: 0, updatedAt })
        ctx.lessons.assistance.remove(lesson.id)
      }
    })
  },
  'share.stop': async ({ lessons, lesson, share, user, command, writeShare }) => {
    // An old capture can end after a different share has already taken its place.
    if (command.expectedShareId && share?.id !== command.expectedShareId) return lessons.snapshotUnlocked(lesson.id)
    if (lesson.instructionPhase && !share) return lessons.snapshotUnlocked(lesson.id)
    if (share && share.ownerId !== user.id && user.id !== lesson.teacherId) throw new ApiError('FORBIDDEN', '자신의 화면 공유만 중지할 수 있습니다.', 403)
    await writeShare(null)
    lessons.assistance.remove(lesson.id)
  },
  'media.update': async ({ payload, requireTeacher, requireShare, writeShare }) => {
    requireTeacher(); const active = requireShare()
    if (active.type !== 'media') throw new ApiError('CONFLICT', '영상 공유 상태가 아닙니다.', 409)
    const body = z.object({ playing: z.boolean(), position: z.number().finite().min(0) }).parse(payload)
    if (active.material?.duration && body.position > active.material.duration + 1) throw new ApiError('VALIDATION', '재생 위치를 확인해 주세요.')
    await writeShare({ ...active, ...body, updatedAt: new Date().toISOString() })
  },
  'document.page': async ({ payload, requireTeacher, requireShare, writeShare }) => {
    requireTeacher(); const active = requireShare()
    const { page } = z.object({ page: z.number().int().min(1) }).parse(payload)
    if (active.type !== 'document' || page > (active.material?.pages || 1)) throw new ApiError('VALIDATION', '문서 페이지를 확인해 주세요.')
    await writeShare({ ...active, page, updatedAt: new Date().toISOString() })
  },
  /** Teacher-only. Annotation permission is stored here; the gateway delivers microphone/camera requests afterwards. */
  'participant.control': async ctx => {
    requireConnectedTeacher(ctx)
    const body = participantControl.parse(ctx.payload)
    const target = ctx.lesson.members.find((member: any) => member.userId === body.userId)
    if (!target || body.userId === ctx.lesson.teacherId || target.banned || !target.online) throw new ApiError('PARTICIPANT_UNAVAILABLE', '수업에 연결된 학생을 선택해 주세요.', 409)
    if (body.annotation === undefined) return ctx.lessons.snapshotUnlocked(ctx.lesson.id)
    if (!ctx.lesson.instructionPhase) throw new ApiError('LESSON_MODE_REQUIRED', '수업 모드를 사용하는 수업에서 판서 허용을 바꿀 수 있어요.', 409)
    if (target.annotationAllowed === body.annotation) return ctx.lessons.snapshotUnlocked(ctx.lesson.id)
    await ctx.db.lessonMember.update({ where: { lessonId_userId: { lessonId: ctx.lesson.id, userId: body.userId } }, data: { annotationAllowed: body.annotation } })
  },
  'stroke.add': strokeAdd,
  'stroke.erase': strokeErase,
  'annotation.undo': annotationHistory(false),
  'annotation.redo': annotationHistory(true),
  'annotation.clear': annotationClear,
  'assistance.request': assistance,
  'assistance.respond': assistance,
  'assistance.start': assistance,
  'assistance.geometry': assistance,
  'assistance.stop': assistance,
} satisfies Record<CommandType, CommandHandler>

export function commandHandler(type: string): CommandHandler {
  const handler = (COMMAND_HANDLERS as Record<string, CommandHandler>)[type]
  if (!handler) throw new ApiError('UNKNOWN_COMMAND', '지원하지 않는 수업 조작입니다.')
  return handler
}

export function commandContext(lessons: Lessons, user: PublicUser, lesson: any, share: Share | null, command: Command, assistanceContext?: AssistanceCommandContext): CommandContext {
  return {
    lessons, db: lessons.db, user, lesson, share, command, payload: command.payload ?? {}, assistanceContext,
    requireShare() { if (!share) throw new ApiError('NO_SHARE', '공유 중인 콘텐츠가 없습니다.', 409); return share },
    requireTeacher() { if (lesson.teacherId !== user.id) throw new ApiError('FORBIDDEN', '선생님만 조작할 수 있습니다.', 403) },
    writeShare: next => lessons.db.lesson.update({ where: { id: lesson.id }, data: { share: shareValue(next) } }),
  }
}
