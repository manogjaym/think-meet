import { useId, useLayoutEffect, useRef, useState } from "react"
import { designContent } from "../../generated/design-content"
import type { User } from "../../generated/contracts"
import { friendlyError } from "../../lib/meeting"
import { Icon } from "../ui"

export function MirroringStudentDialog({ students, connected, blocked, onClose, onRequest }: {
  students: User[]
  connected: boolean
  blocked?: string
  onClose: () => void
  onRequest: (studentId: string) => Promise<void>
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const [selectedId, setSelectedId] = useState<string>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const selected = students.find(student => student.id === selectedId)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    cancelRef.current?.focus()
    return () => dialog?.close()
  }, [])

  async function request() {
    if (!selected || pending || blocked || !connected) return
    setPending(true)
    setError("")
    try {
      await onRequest(selected.id)
      onClose()
    } catch (error) {
      setError(friendlyError(error))
    } finally {
      setPending(false)
    }
  }

  return <dialog ref={dialogRef} className="screen-share-dialog mirroring-student-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (!pending) onClose() }}>
    <div className="share-dialog-heading">
      <div className="confirm-icon"><Icon name="screen" size={19} /></div>
      <h2 id={titleId}>{designContent.meetingMirroringStudentTitle}</h2>
    </div>
    <p id={descriptionId}>{designContent.remoteAssistRequestHelp}</p>
    {blocked && <p role="status">{blocked}</p>}
    {students.length === 0 ? <p role="status">{designContent.meetingMirroringNoStudents}</p> :
      <div className="share-targets mirroring-students" role="group" aria-label={designContent.meetingMirroringStudentTitle}>
        {students.map(student => <button key={student.id} type="button" aria-pressed={selected?.id === student.id}
          className={selected?.id === student.id ? "selected" : ""} disabled={pending || !!blocked}
          onClick={() => { setSelectedId(student.id); setError("") }}>
          <div><strong>{student.name}</strong></div>
          <i aria-hidden="true">{selected?.id === student.id && <Icon name="check" size={14} />}</i>
        </button>)}
      </div>}
    {error && <p role="alert">{error}</p>}
    <footer>
      <button ref={cancelRef} type="button" className="secondary" disabled={pending} onClick={onClose}>취소</button>
      <button type="button" className="primary" disabled={!selected || pending || !connected || !!blocked} onClick={() => void request()}>
        {designContent.meetingMirroringRequest}
      </button>
    </footer>
  </dialog>
}
