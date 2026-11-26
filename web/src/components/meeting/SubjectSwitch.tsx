import { useEffect, useState } from "react"
import type { ApiLesson, TeacherSubject } from "../../generated/contracts"
import { designContent } from "../../generated/design-content"
import { call } from "../../lib/api"
import { friendlyError } from "../../lib/meeting"
import { AnimatedPresence } from "../AnimatedPresence"
import { LessonSubjectDialog } from "../LessonSubjectDialog"
import { Confirm } from "../ui"

export const fillSubject = (text: string, subject: string) => text.split("{subject}").join(subject)

/**
 * classroom.subject-switch: the lesson-form subject picker, then a confirmation.
 * The server ends this lesson and starts the new one; the meeting follows `nextLessonId` itself.
 */
export function SubjectSwitch({ lesson, open, onClose, recording, sharing, onSwitched, onError }: {
  lesson: ApiLesson
  open: boolean
  onClose: () => void
  /** The web tab recording continues into the new lesson as a separate file. */
  recording: boolean
  /** A screen share or mirroring is running; it ends with the old lesson. */
  sharing: boolean
  onSwitched: (next: ApiLesson) => void
  onError: (message: string) => void
}) {
  const [subjects, setSubjects] = useState<TeacherSubject[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [lessons, setLessons] = useState<ApiLesson[]>([])
  const [target, setTarget] = useState<TeacherSubject | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const request = new AbortController()
    setFailed(false)
    void call("listTeacherSubjects", { signal: request.signal }).then(setSubjects, () => { if (!request.signal.aborted) setFailed(true) })
    // Only for each subject's latest completed lesson on the cards; the picker works without it.
    void call("listLessons", { signal: request.signal }).then(setLessons, () => undefined)
    return () => request.abort()
  }, [open, retry])

  const confirm = async () => {
    if (!target || busy) return
    setBusy(true)
    try {
      const next = await call("switchLessonSubject", { params: { id: lesson.id }, body: { subjectId: target.id } })
      setTarget(null)
      onSwitched(next)
    } catch (error) {
      setTarget(null)
      onError(friendlyError(error))
    } finally { setBusy(false) }
  }

  return <>
    {open && !target && <LessonSubjectDialog subjects={subjects} selectedId={lesson.subject?.id ?? null} failed={failed} required
      lessons={lessons} teacherId={lesson.teacher.id} onRetry={() => setRetry(value => value + 1)} onClose={onClose}
      onSelect={id => {
        const subject = subjects?.find(item => item.id === id)
        if (!subject || subject.id === lesson.subject?.id) return
        setTarget(subject)
      }} />}
    <AnimatedPresence show={!!target}>
      {target && <Confirm icon="calendar" confirmClassName="primary"
        title={fillSubject(designContent.meetingSubjectSwitchTitle, target.name)}
        copy={fillSubject(designContent.meetingSubjectSwitchCopy, target.name)}
        note={[sharing && designContent.meetingSubjectSwitchShareCopy, recording && designContent.meetingSubjectSwitchRecordingCopy].filter(Boolean).join(" ") || undefined}
        cancelText="취소" confirmText={busy ? "바꾸는 중…" : designContent.meetingSubjectSwitchAction}
        cancel={() => { if (!busy) setTarget(null) }}
        confirm={() => void confirm()} />}
    </AnimatedPresence>
  </>
}
