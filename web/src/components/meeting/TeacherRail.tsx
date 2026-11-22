import { useEffect, useState } from "react"
import { designContent } from "../../generated/design-content"
import type { MeetingSnapshot } from "../../lib/meeting"
import { currentAssistance } from "../../lib/remoteAssistance"
import { Icon } from "../ui"

/** Lesson owner's materials card under the participant videos in the right rail. */
export function MaterialsCard({ textbookDisabled, onTextbook }: { textbookDisabled: boolean; onTextbook: () => void }) {
  const [notice, setNotice] = useState(false)
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(false), 2500)
    return () => window.clearTimeout(timer)
  }, [notice])
  const comingSoon = () => setNotice(true)
  return <section className="materials-card" aria-labelledby="materials-card-title">
    <h2 id="materials-card-title">{designContent.meetingMaterialsTitle}</h2>
    <button className="materials-item" disabled={textbookDisabled} onClick={onTextbook}><Icon name="grid" size={18} />{designContent.meetingMaterialsTextbook}</button>
    <button className="materials-item" onClick={comingSoon}><Icon name="file" size={18} />{designContent.meetingMaterialsWorksheet}</button>
    <button className="materials-subject" onClick={comingSoon}>{designContent.meetingMaterialsSubject}</button>
    <button className="materials-homework" onClick={comingSoon}><Icon name="calendar" size={18} />{designContent.meetingMaterialsHomework}</button>
    <p className="materials-notice" role="status">{notice ? designContent.meetingMaterialsComingSoon : ""}</p>
  </section>
}

/** Main stage guidance for the lesson owner while nothing is shared. */
export function TeacherStageGuide({ snapshot, disabled, onShare, onPickStudent }: {
  snapshot: MeetingSnapshot | null
  disabled: boolean
  onShare: () => void
  onPickStudent: () => void
}) {
  const phase = snapshot?.instruction?.phase
  const session = currentAssistance(snapshot?.assistance) ? snapshot?.assistance : null
  const student = session && snapshot?.participants.find(entry => entry.user.id === session.studentId)?.user.name
  const waiting = phase === "mirroring" && session
  return <div className="teacher-stage-guide" role="status">
    <span className="teacher-stage-icon"><Icon name="screen" size={34} /></span>
    {waiting ? <p>{student && <strong>{student} </strong>}{session.status === "pending" ? designContent.remoteAssistWaiting : designContent.remoteAssistPreparing}</p>
      : <p>{phase === "classroom" ? designContent.meetingStageClassroom : phase === "mirroring" ? designContent.meetingStageMirroring : designContent.meetingStagePreparing}</p>}
    {phase === "classroom" && <button disabled={disabled} onClick={onShare}>{designContent.meetingStageClassroomAction}</button>}
    {phase === "mirroring" && !session && <button disabled={disabled} onClick={onPickStudent}>{designContent.meetingStageMirroringAction}</button>}
  </div>
}
