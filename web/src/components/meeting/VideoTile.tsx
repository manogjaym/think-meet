import { useEffect, useRef } from "react"
import { Track, type Participant, type VideoTrack } from "livekit-client"
import { useParticipantSpeaking, useParticipantTrack } from "../../lib/livekitMedia"
import { Icon } from "../ui"

export function VideoTile({ person, small = false, hand = false, self = false, participant, teacher = false }: {
  person: string
  small?: boolean
  hand?: boolean
  self?: boolean
  participant?: Participant
  teacher?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const camera = useParticipantTrack(participant, Track.Source.Camera)
  const muted = !useParticipantTrack(participant, Track.Source.Microphone).enabled
  const speaking = useParticipantSpeaking(participant)
  const track = camera.enabled ? camera.track as VideoTrack | undefined : undefined
  useEffect(() => {
    const video = videoRef.current
    if (!video || !track) return
    track.attach(video)
    return () => { track.detach(video) }
  }, [track])
  const displayName = person.replace(" 선생님", "")
  const initial = displayName.length > 1 ? displayName.slice(-2) : displayName
  return (
    <div className={`video-tile tile-${teacher ? "blue" : "sage"} ${small ? "small" : ""} ${speaking ? "is-speaking" : ""}`} aria-label={`${person}${self ? ", 나" : ""}${muted ? ", 음소거" : ""}`} data-participant={participant?.identity}>
      {track ? <video ref={videoRef} autoPlay playsInline muted className={`live-camera ${self ? "is-self" : ""}`} /> : <>
        <div className="tile-avatar" aria-hidden="true">{initial}</div>
        {!small && <span className="tile-camera-status"><Icon name={camera.enabled ? "video" : "videoOff"} size={14} />{camera.enabled ? "영상 연결 중" : "카메라 꺼짐"}</span>}
      </>}
      <span className="name-tag">{teacher && <span className="host-label">선생님</span>}{displayName}{self ? " (나)" : ""}</span>
      {hand && <span className="hand-badge"><Icon name="hand" size={17} />손들기</span>}
      <span className={`mic-state ${muted ? "off" : ""}`} title={muted ? "음소거" : "마이크 켜짐"}><Icon name={muted ? "micOff" : "mic"} size={16} /></span>
    </div>
  )
}
