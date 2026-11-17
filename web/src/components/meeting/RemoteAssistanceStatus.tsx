import { useState } from "react"
import { designContent } from "../../generated/design-content"
import { currentAssistance } from "../../lib/remoteAssistance"
import { useFeature } from "../../lib/useFeature"
import { friendlyError, type Command, type MeetingSnapshot } from "../../lib/meeting"

export function RemoteAssistanceStatus({ snapshot, userId, command, onError, pointingReady = false }: { snapshot: MeetingSnapshot | null; userId: string; command: Command; onError: (message: string) => void; pointingReady?: boolean }) {
  const enabled = useFeature("meeting.remote-assistance")
  const [pending, setPending] = useState(false)
  const session = snapshot?.assistance
  if (!currentAssistance(session) || ![session.teacherId, session.studentId].includes(userId)) return null
  const teacher = session.teacherId === userId
  // Existing sessions keep cleanup available even if a refresh disables new requests.
  const message = !teacher || !enabled ? designContent.remoteAssistUnsupported : session.status === "pending" ? designContent.remoteAssistWaiting : session.status === "approved" ? designContent.remoteAssistPreparing : pointingReady ? designContent.remoteAssistActive : designContent.remoteAssistGeometryWaiting
  const student = snapshot?.participants.find(entry => entry.user.id === session.studentId)?.user.name
  return <div className="remote-assistance-status" role="status">
    <span>{student && teacher && <strong>{student}</strong>}{message}</span>
    <button disabled={pending} onClick={() => {
      setPending(true)
      void command("assistance.stop", { sessionId: session.id }).catch(error => onError(friendlyError(error))).finally(() => setPending(false))
    }}>{designContent.remoteAssistStop}</button>
  </div>
}
