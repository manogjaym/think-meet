import { Prisma } from '@prisma/client'
import { TrackSource } from 'livekit-server-sdk'
import type { Lessons } from '../lessons'
import { readShare } from './share'

const screenShareRecoveryMs = 30_000

/**
 * Periodic repair of DB presence and shares against LiveKit, plus expiry cleanup.
 * Runs on the single API instance (see server/README.md "운영 전제").
 */
export class LessonReconciler {
  // In-memory grace window: a screen share may briefly disappear while the owner reconnects.
  private missingScreenShares = new Map<string, { shareId: string; since: number }>()
  constructor(private readonly lessons: Lessons) {}

  async run() {
    const { lessons } = this
    const { db } = lessons
    for (const session of lessons.assistance.sweep(binding => lessons.assistanceConnected(binding))) await lessons.locked(session.lessonId, async () => {
      await lessons.clearAssistanceShare(session)
      await lessons.broadcast(session.lessonId)
    })
    const active = await db.lesson.findMany({ where: { status: { in: ['LIVE','SCHEDULED'] }, OR: [{ members: { some: { admissionId: { not: null } } } }, { share: { not: Prisma.DbNull } }] }, include: { members: true } })
    const activeIds = new Set(active.map(lesson => lesson.id))
    for (const id of this.missingScreenShares.keys()) if (!activeIds.has(id)) this.missingScreenShares.delete(id)
    for (const candidate of active) await lessons.locked(candidate.id, () => this.reconcileLesson(candidate.id))
    await db.loginSession.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    await db.webhookEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 86400000) } } })
  }

  private async reconcileLesson(id: string) {
    const { lessons } = this
    const lesson = await lessons.get(id)
    let participants: Awaited<ReturnType<Lessons['livekit']['listParticipants']>>
    try { participants = await lessons.livekit.listParticipants(lesson.roomName) } catch (error: any) { if (error.status !== 404 && error.code !== 'not_found') return; participants = [] }
    let changed = false
    for (const participant of participants) {
      const member = lesson.members.find(member => member.userId === participant.identity)
      if (!member?.online || member.banned) { await lessons.applyParticipant(lesson, participant); changed = true }
    }
    for (const member of lesson.members) if (member.online && !participants.some(participant => participant.identity === member.userId)) { await lessons.offline(lesson.id, member.userId); changed = true }
    const share = readShare(lesson.share)
    const screenMissing = share?.type === 'screen' && !share.assistanceId && !participants.some(participant =>
      participant.identity === share.ownerId && participant.tracks.some(track => track.source === TrackSource.SCREEN_SHARE))
    let screenExpired = false
    if (screenMissing) {
      const missing = this.missingScreenShares.get(lesson.id)
      const now = Date.now()
      if (missing?.shareId === share.id) screenExpired = now - missing.since >= screenShareRecoveryMs
      else this.missingScreenShares.set(lesson.id, { shareId: share.id, since: now })
    } else this.missingScreenShares.delete(lesson.id)
    if (share) {
      const owner = await lessons.db.lessonMember.findUnique({ where: { lessonId_userId: { lessonId: lesson.id, userId: share.ownerId } } })
      const ownerExpired = !owner?.online && owner?.disconnectedAt && Date.now() - owner.disconnectedAt.getTime() > screenShareRecoveryMs
      if (screenExpired || ownerExpired || share.assistanceId && lessons.assistance.current(lesson.id)?.id !== share.assistanceId) {
        await lessons.db.lesson.update({ where: { id: lesson.id }, data: { share: Prisma.DbNull } })
        this.missingScreenShares.delete(lesson.id)
        changed = true
      }
    }
    if (changed) await lessons.broadcast(lesson.id)
  }
}
