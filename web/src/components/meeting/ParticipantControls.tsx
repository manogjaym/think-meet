import { createContext, useContext, useState } from "react"
import { Track, type Participant } from "livekit-client"
import { designContent } from "../../generated/design-content"
import { useParticipantTrack } from "../../lib/livekitMedia"
import { friendlyError, type Command } from "../../lib/meeting"
import { Icon } from "../ui"

/** What a video tile needs to render controls; absent when the feature is unavailable. */
export type ParticipantControlState = {
  viewerId: string
  teacherId: string
  /** Annotation permission exists only in lessons that use lesson modes. */
  lessonModes: boolean
  annotationAllowed: (userId: string) => boolean
  online: (userId: string) => boolean
  command: Command
  setMic: (enabled: boolean) => Promise<void>
  setCam: (enabled: boolean) => Promise<void>
  onError: (message: string) => void
}

export const ParticipantControlsContext = createContext<ParticipantControlState | null>(null)

/** Only the teacher sees tile controls: their own and each student's. Students use the call bar for their own devices. */
export function participantControlsVisible(state: ParticipantControlState | null, userId: string | undefined, self: boolean) {
  if (!state || !userId || state.viewerId !== state.teacherId) return false
  return self || userId !== state.teacherId
}

export function useParticipantControlState() {
  return useContext(ParticipantControlsContext)
}

type Pending = "microphone" | "camera" | "annotation" | null

export function ParticipantControls({ participant, userId, name, self }: { participant?: Participant; userId: string; name: string; self: boolean }) {
  const state = useParticipantControlState()
  const mic = useParticipantTrack(participant, Track.Source.Microphone).enabled
  const cam = useParticipantTrack(participant, Track.Source.Camera).enabled
  const [pending, setPending] = useState<Pending>(null)
  if (!state || !participantControlsVisible(state, userId, self)) return null
  const remote = !self
  const available = Boolean(participant) && (self || state.online(userId))
  const run = async (kind: Exclude<Pending, null>, action: () => Promise<unknown>) => {
    setPending(kind)
    try { await action() } catch (error) { state.onError(friendlyError(error)) } finally { setPending(null) }
  }
  const toggle = (kind: "microphone" | "camera", next: boolean) => run(kind, () => remote
    ? state.command("participant.control", { userId, [kind]: next })
    : kind === "microphone" ? state.setMic(next) : state.setCam(next))
  const annotation = state.annotationAllowed(userId)
  const micLabel = mic ? designContent.participantMicOff : designContent.participantMicOn
  const camLabel = cam ? designContent.participantCameraOff : designContent.participantCameraOn
  return <div className="participant-controls" role="group" aria-label={`${name} ${designContent.participantControlsLabel}`}>
    <button type="button" className={`participant-control ${mic ? "" : "off"}`} aria-pressed={!mic} aria-label={`${name} ${micLabel}`} title={micLabel}
      disabled={!available || pending !== null} onClick={() => void toggle("microphone", !mic)}><Icon name={mic ? "mic" : "micOff"} size={18} /></button>
    <button type="button" className={`participant-control ${cam ? "" : "off"}`} aria-pressed={!cam} aria-label={`${name} ${camLabel}`} title={camLabel}
      disabled={!available || pending !== null} onClick={() => void toggle("camera", !cam)}><Icon name={cam ? "video" : "videoOff"} size={18} /></button>
    {remote && state.lessonModes && <button type="button" className={`participant-control annotation ${annotation ? "selected" : ""}`} aria-pressed={annotation} aria-label={`${name} ${designContent.participantAnnotation}`}
      disabled={!state.online(userId) || pending !== null} onClick={() => void run("annotation", () => state.command("participant.control", { userId, annotation: !annotation }))}>
      <Icon name="pen" size={16} /><span>{designContent.participantAnnotation}</span></button>}
  </div>
}
