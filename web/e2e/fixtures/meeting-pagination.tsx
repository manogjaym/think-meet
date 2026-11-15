import { useState } from "react"
import { createRoot } from "react-dom/client"
import type { Participant, Room } from "livekit-client"
import type { ApiLesson, User } from "../../src/lib/api"
import type { MeetingSnapshot } from "../../src/lib/meeting"
import { ParticipantGallery } from "../../src/components/meeting/ParticipantGallery"
import { SharedStage } from "../../src/components/meeting/SharedStage"
import { SidePanel } from "../../src/components/meeting/SidePanel"
import { VideoTile } from "../../src/components/meeting/VideoTile"
import "../../src/index.css"
import "../../src/meeting.css"
import "../../src/components/meeting/live-meeting.css"

const people: User[] = Array.from({ length: 25 }, (_, index) => ({
  id: `participant-${index}`,
  name: `참가자 ${String(index + 1).padStart(2, "0")}`,
  username: `pagination-${index}`,
  role: index === 0 ? "teacher" : "student",
}))
const participant = (person: User) =>
  ({
    identity: person.id,
    name: person.name,
    isCameraEnabled: false,
    isMicrophoneEnabled: true,
    isSpeaking: false,
    getTrackPublication: () => undefined,
    audioTrackPublications: new Map(),
  }) as unknown as Participant
const now = new Date().toISOString()

function Harness() {
  const [count, setCount] = useState(25)
  const [layout, setLayout] = useState<"grid" | "speaker">("grid")
  const [sharing, setSharing] = useState(false)
  const [panel, setPanel] = useState<"people" | null>(null)
  const [error, setError] = useState("")
  const roster = people.slice(0, count)
  const participants = roster.map(participant)
  const room = {
    localParticipant: participants[0] || participant(people[0]),
    remoteParticipants: new Map(
      participants.slice(1).map((person) => [person.identity, person]),
    ),
  } as unknown as Room
  const lesson: ApiLesson = {
    id: "pagination-fixture",
    title: "참가자 페이지 검증",
    description: "",
    teacher: people[0],
    students: roster.slice(1),
    startsAt: now,
    endsAt: null,
    status: "LIVE",
    code: "pagination",
    startedAt: now,
    endedAt: null,
  }
  const snapshot: MeetingSnapshot = {
    lessonId: lesson.id,
    lesson,
    participants: roster.map((user) => ({ user, online: true, raised: false })),
    messages: [],
    strokes: [],
    seq: 1,
    serverTime: now,
    share: sharing
      ? {
          id: "fixture-share",
          type: "screen",
          ownerId: people[0].id,
          page: 1,
          playing: false,
          position: 0,
          updatedAt: now,
        }
      : null,
  }
  return (
    <main className={`meeting ${panel ? "has-panel" : ""}`}>
      <header className="meeting-head">
        <h1>{lesson.title}</h1>
      </header>
      {error && <p role="alert">{error}</p>}
      <div className="meeting-body">
        <div className="meeting-main">
          {sharing && (
            <div className="share-status-bar">
              <span>참가자 01 님의 화면 공유 중</span>
              <button onClick={() => setSharing(false)}>공유 중지</button>
            </div>
          )}
          <section
            className={`stage ${sharing ? "is-sharing" : ""}`}
            aria-label="수업 화면"
          >
            {sharing ? (
              <SharedStage
                user={people[0]}
                snapshot={snapshot}
                room={room}
                command={async () => snapshot}
                previews={{}}
                sendPreview={() => {}}
                serverOffset={0}
                outputDevice="muted"
                revision={0}
                onError={setError}
              />
            ) : (
              <ParticipantGallery
                participants={participants}
                layout={layout}
                renderParticipant={(person) => (
                  <VideoTile
                    key={person.identity}
                    person={person.name}
                    participant={person}
                    teacher={person.identity === people[0].id}
                    self={person.identity === people[0].id}
                  />
                )}
              />
            )}
          </section>
        </div>
        <div
          id="meeting-side-panel"
          className="meeting-panel-container"
          inert={!panel}
          aria-hidden={!panel}
        >
          <SidePanel
            panel={panel}
            setPanel={(value) => setPanel(value === "people" ? "people" : null)}
            user={people[0]}
            lesson={lesson}
            room={room}
            snapshot={snapshot}
            command={async () => snapshot}
            onOutputChange={() => {}}
            revision={0}
          />
        </div>
      </div>
      <footer className="call-controls">
        <button
          onClick={() =>
            setLayout((value) => (value === "grid" ? "speaker" : "grid"))
          }
        >
          보기 전환
        </button>
        <button onClick={() => setCount(7)}>참가자 7명</button>
        <button onClick={() => setCount(2)}>참가자 2명</button>
        <button onClick={() => setCount(0)}>참가자 0명</button>
        <button onClick={() => setSharing((value) => !value)}>공유 전환</button>
        <button onClick={() => setPanel((value) => (value ? null : "people"))}>
          목록 전환
        </button>
      </footer>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<Harness />)
