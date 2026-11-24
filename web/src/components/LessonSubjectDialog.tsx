import { useId, useLayoutEffect, useRef } from "react"
import type { ApiLesson, TeacherSubject } from "../generated/contracts"
import { designContent } from "../generated/design-content"
import { completedLessonTime } from "../lib/lessonRecord"
import { Icon } from "./ui"

type Props = {
  subjects: TeacherSubject[] | null
  selectedId: string | null
  failed: boolean
  required?: boolean
  lessons: ApiLesson[]
  teacherId: string
  onRetry: () => void
  onClose: () => void
  onSelect: (id: string | null) => void
}

export function LessonSubjectDialog({ subjects, selectedId, failed, required = false, lessons, teacherId, onRetry, onClose, onSelect }: Props) {
  const title = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    closeRef.current?.focus()
    return () => dialog?.close()
  }, [])

  const latest = new Map<string, { title: string; time: string; ended: number }>()
  for (const lesson of lessons) {
    if (!lesson.subject || lesson.teacher.id !== teacherId || !lesson.endedAt) continue
    const ended = Date.parse(lesson.endedAt)
    const previous = latest.get(lesson.subject.id)
    if (previous && previous.ended >= ended) continue
    const time = completedLessonTime(lesson)
    if (time) latest.set(lesson.subject.id, { title: lesson.title, time, ended })
  }

  return <dialog ref={dialogRef} className="lesson-subject-dialog" aria-labelledby={title}
    onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="lesson-subject-dialog-content">
      <header className="lesson-subject-dialog-header">
        <h2 id={title}>{designContent.lessonSubjectPickerTitle}</h2>
        <button ref={closeRef} type="button" className="lesson-subject-close" aria-label={designContent.lessonSubjectPickerClose} onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
      </header>
      {failed ? (
        <div className="lesson-subject-status">
          <p role="status">{designContent.lessonSubjectsError}</p>
          <button type="button" className="secondary" onClick={onRetry}>{designContent.lessonSubjectsRetry}</button>
        </div>
      ) : subjects === null ? (
        <p role="status" className="lesson-subject-status">{designContent.lessonSubjectsLoading}</p>
      ) : subjects.length === 0 ? (
        <p role="status" className="lesson-subject-status">{designContent.lessonSubjectsEmpty}</p>
      ) : (
        <div className="lesson-subject-grid">
          {subjects.map(subject => {
            const record = latest.get(subject.id)
            const selected = selectedId === subject.id
            return <button key={subject.id} type="button" className="lesson-subject-card"
              aria-pressed={selected} onClick={() => onSelect(subject.id)}>
              <span className="lesson-subject-card-title">
                <strong>{subject.name}</strong>
                {selected && <Icon name="check" size={18} />}
              </span>
              <span className="lesson-subject-record">
                <span>{designContent.lessonSubjectRecord}</span>
                {record ? <><strong>{record.title}</strong><span>{record.time}</span></>
                  : <span>{designContent.lessonSubjectRecordEmpty}</span>}
              </span>
            </button>
          })}
        </div>
      )}
      {subjects !== null && !required && <footer>
        <button type="button" className="secondary" onClick={() => onSelect(null)}>{designContent.lessonSubjectNone}</button>
      </footer>}
    </div>
  </dialog>
}
