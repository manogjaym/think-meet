import { Prisma } from '@prisma/client'
import { z } from 'zod'
import type { Share } from '../types'

const materialSchema = z.object({
  id: z.string(), name: z.string(), type: z.enum(['media', 'document']), size: z.number(),
  duration: z.number().nullable().optional(), pages: z.number().nullable().optional(), createdAt: z.string(),
})
/** Runtime shape of Lesson.share (a JSON column). Mirrors the generated Share contract. */
export const shareSchema = z.object({
  id: z.string(), type: z.enum(['screen', 'media', 'document']), ownerId: z.string(),
  materialId: z.string().optional(), material: materialSchema.optional(),
  page: z.number().int(), playing: z.boolean(), position: z.number(), updatedAt: z.string(),
  assistanceId: z.string().optional(),
}) satisfies z.ZodType<Share>

/** Reads a stored share; malformed JSON is treated as "no share" instead of crashing every snapshot. */
export function readShare(value: unknown): Share | null {
  if (value === null || value === undefined) return null
  const parsed = shareSchema.safeParse(value)
  if (parsed.success) return parsed.data
  console.error('ignoring malformed lesson share', parsed.error.issues[0]?.message)
  return null
}

/** Prisma write value for Lesson.share. */
export const shareValue = (share: Share | null) => share ? share as unknown as Prisma.InputJsonValue : Prisma.DbNull
