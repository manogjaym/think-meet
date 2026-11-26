import { useEffect, useState } from "react"
import { designContent } from "../../generated/design-content"
import { friendlyError, type Command, type MeetingSnapshot } from "../../lib/meeting"
import { currentAssistance } from "../../lib/remoteAssistance"
import { Icon } from "../ui"

/** Lesson owner's materials card under the participant videos in the right rail. */
export function MaterialsCard({ textbookDisabled, onTextbook, subjectDisabled = false, onSubject }: {
  textbookDisabled: boolean
  onTextbook: () => void
  subjectDisabled?: boolean
  /** classroom.subject-switch; without it the button only shows the coming-soon notice. */
  onSubject?: () => void
}) {
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
    <button className="materials-subject" aria-haspopup={onSubject ? "dialog" : undefined} disabled={!!onSubject && subjectDisabled} onClick={onSubject ?? comingSoon}>{designContent.meetingMaterialsSubject}</button>
    <button className="materials-homework" onClick={comingSoon}><Icon name="calendar" size={18} />{designContent.meetingMaterialsHomework}</button>
    <p className="materials-notice" role="status">{notice ? designContent.meetingMaterialsComingSoon : ""}</p>
  </section>
}

/** Main stage guidance for the lesson owner while nothing is shared, including a mirroring request awaiting the student. */
export function TeacherStageGuide({ snapshot, disabled, onShare, onPickStudent, command, onError }: {
  snapshot: MeetingSnapshot | null
  disabled: boolean
  onShare: () => void
  onPickStudent: () => void
  command: Command
  onError: (message: string) => void
}) {
  const [stopping, setStopping] = useState(false)
  const phase = snapshot?.instruction?.phase
  const session = currentAssistance(snapshot?.assistance) ? snapshot?.assistance : null
  const student = session && snapshot?.participants.find(entry => entry.user.id === session.studentId)?.user.name
  const waiting = phase === "mirroring" && session
  const stop = () => {
    if (!session || stopping) return
    setStopping(true)
    void command("assistance.stop", { sessionId: session.id }).catch(error => onError(friendlyError(error))).finally(() => setStopping(false))
  }
  return <div className={`teacher-stage-guide ${waiting ? "is-waiting" : ""}`} role="status">
    <span className="teacher-stage-icon"><Icon name="screen" size={34} /></span>
    {waiting ? <p>{session.status === "pending" ? `${student ? `${student} ` : ""}${designContent.meetingMirroringWaiting}` : designContent.remoteAssistPreparing}</p>
      : <p>{phase === "classroom" ? designContent.meetingStageClassroom : phase === "mirroring" ? designContent.meetingStageMirroring : designContent.meetingStagePreparing}</p>}
    {waiting && <button className="teacher-stage-cancel" disabled={stopping} onClick={stop}>{session.status === "pending" ? designContent.meetingLessonCancelRequest : designContent.remoteAssistStop}</button>}
    {phase === "classroom" && <button disabled={disabled} onClick={onShare}>{designContent.meetingStageClassroomAction}</button>}
    {phase === "mirroring" && !session && <button disabled={disabled} onClick={onPickStudent}>{designContent.meetingStageMirroringAction}</button>}
  </div>
}
