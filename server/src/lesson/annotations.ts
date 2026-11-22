import { z } from 'zod'
import { ApiError } from '../errors'
import type { CommandContext } from './commands'
import { annotationAllowed } from './dto'

/** Lesson-mode students annotate only while the teacher allows it; checked before every annotation change. */
export function requireAnnotator({ lesson, user }: Pick<CommandContext, 'lesson' | 'user'>) {
  if (!annotationAllowed(lesson, user.id)) throw new ApiError('ANNOTATION_NOT_ALLOWED', '선생님이 판서를 허용하면 그릴 수 있어요.', 403)
}

type Patch = { id: string; before: boolean; after: boolean }
const strokeInput = z.object({ id: z.string().uuid(), shareId: z.string().uuid(), page: z.number().int().min(1), tool: z.enum(['pen','highlighter']), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(20000) })

/** A new stroke clears this author's redo stack on the current share page. */
export async function strokeAdd({ db, lesson, user, payload, requireShare }: CommandContext) {
  requireAnnotator({ lesson, user })
  const active = requireShare()
  const body = strokeInput.parse(payload)
  if (body.shareId !== active.id || body.page !== active.page) throw new ApiError('STALE_SHARE', '공유 화면이 변경되었습니다.', 409)
  const existing = await db.stroke.findUnique({ where: { id: body.id } })
  if (existing && (existing.authorId !== user.id || existing.lessonId !== lesson.id)) throw new ApiError('CONFLICT', '중복된 판서 번호입니다.', 409)
  if (existing) return
  await db.$transaction([
    db.stroke.create({ data: { ...body, lessonId: lesson.id, authorId: user.id } }),
    db.annotationOperation.deleteMany({ where: { lessonId: lesson.id, actorId: user.id, shareId: active.id, page: active.page, undone: true } }),
    db.annotationOperation.create({ data: { lessonId: lesson.id, actorId: user.id, shareId: active.id, page: active.page, patches: [{ id: body.id, before: true, after: false }] } }),
  ])
}

/** Students erase only their own strokes; the lesson teacher may erase any. */
export async function strokeErase({ db, lesson, user, payload, requireShare }: CommandContext) {
  requireAnnotator({ lesson, user })
  const active = requireShare()
  const { ids } = z.object({ ids: z.array(z.string().uuid()).max(500) }).parse(payload)
  const where = { id: { in: ids }, lessonId: lesson.id, shareId: active.id, page: active.page, ...(user.id === lesson.teacherId ? {} : { authorId: user.id }) }
  const targets = await db.stroke.findMany({ where: { ...where, deleted: false } })
  if (!targets.length) return
  await db.$transaction([
    db.stroke.updateMany({ where, data: { deleted: true } }),
    db.annotationOperation.deleteMany({ where: { lessonId: lesson.id, actorId: user.id, shareId: active.id, page: active.page, undone: true } }),
    db.annotationOperation.create({ data: { lessonId: lesson.id, actorId: user.id, shareId: active.id, page: active.page, patches: targets.map(stroke => ({ id: stroke.id, before: false, after: true })) } }),
  ])
}

/** Undo/redo are per author and per share page. */
export const annotationHistory = (redo: boolean) => async ({ db, lesson, user, requireShare }: CommandContext) => {
  requireAnnotator({ lesson, user })
  const active = requireShare()
  const operation = await db.annotationOperation.findFirst({
    where: { lessonId: lesson.id, actorId: user.id, shareId: active.id, page: active.page, undone: redo },
    orderBy: redo ? { touchedAt: 'desc' } : { createdAt: 'desc' },
  })
  if (!operation) return
  await db.$transaction([
    ...(operation.patches as Patch[]).map(patch => db.stroke.updateMany({ where: { id: patch.id, lessonId: lesson.id, shareId: active.id, page: active.page }, data: { deleted: redo ? patch.after : patch.before } })),
    db.annotationOperation.update({ where: { id: operation.id }, data: { undone: !redo } }),
  ])
}

/** Clears strokes and drops them from every undo history so they cannot be restored. */
export async function annotationClear({ db, lesson, user, requireShare }: CommandContext) {
  requireAnnotator({ lesson, user })
  const active = requireShare()
  const where = { lessonId: lesson.id, shareId: active.id, page: active.page, ...(user.id === lesson.teacherId ? {} : { authorId: user.id }) }
  const targets = await db.stroke.findMany({ where, select: { id: true } })
  const targetIds = new Set(targets.map(stroke => stroke.id))
  const operations = await db.annotationOperation.findMany({ where: { lessonId: lesson.id, shareId: active.id, page: active.page } })
  await db.$transaction([
    db.stroke.updateMany({ where, data: { deleted: true } }),
    ...operations.flatMap(operation => {
      const previous = operation.patches as Patch[]
      const patches = previous.filter(patch => !targetIds.has(patch.id))
      if (patches.length === previous.length) return []
      return [patches.length ? db.annotationOperation.update({ where: { id: operation.id }, data: { patches } }) : db.annotationOperation.delete({ where: { id: operation.id } })]
    }),
  ])
}
