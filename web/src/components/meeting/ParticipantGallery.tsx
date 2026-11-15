import type { CSSProperties, ReactNode, Ref } from "react"
import type { Participant } from "livekit-client"
import designLayout from "../../generated/design-layout.json"
import {
  ParticipantPagination,
  useParticipantArea,
  useParticipantPagination,
} from "./ParticipantPagination"

type GalleryProps = {
  participants: Participant[]
  layout: "grid" | "speaker"
  renderParticipant: (participant: Participant) => ReactNode
  gridRef?: Ref<HTMLDivElement>
}

export function ParticipantGallery({
  participants,
  layout,
  renderParticipant,
  gridRef,
}: GalleryProps) {
  const { areaRef, width, height } = useParticipantArea()
  const narrow = width > 0 && width < designLayout.meetingCompactBreakpoint
  const gap = narrow ? 8 : 12
  const columns = width
    ? Math.max(
        1,
        Math.min(
          narrow ? 2 : 3,
          Math.floor((width + gap) / ((narrow ? 160 : 240) + gap)),
        ),
      )
    : 3
  // Reserve room for navigation even on a single page to keep capacity stable.
  const rows = height
    ? Math.max(
        1,
        Math.min(narrow ? 2 : 3, Math.floor((height - 52 + gap) / (170 + gap))),
      )
    : 3
  const featured = layout === "speaker" ? participants[0] : undefined
  const paginated = featured ? participants.slice(1) : participants
  const pagination = useParticipantPagination(
    paginated.length,
    layout === "speaker" ? 3 : columns * rows,
  )
  const visible = paginated.slice(pagination.start, pagination.end)
  if (featured) visible.unshift(featured)
  const visibleColumns = Math.max(
    1,
    Math.min(
      columns,
      Math.max(
        Math.ceil(visible.length / rows),
        Math.ceil(Math.sqrt(visible.length)),
      ),
    ),
  )
  const style: CSSProperties =
    layout === "grid"
      ? {
          gridTemplateColumns: `repeat(${visibleColumns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${Math.max(1, Math.ceil(visible.length / visibleColumns))}, minmax(0, 1fr))`,
        }
      : {
          "--speaker-thumbnails": Math.max(1, visible.length - 1),
        } as CSSProperties

  return (
    <div ref={areaRef} className="participant-gallery">
      <div
        ref={gridRef}
        id="meeting-video-grid"
        className={`video-grid stage-view count-${visible.length} layout-${layout}`}
        style={style}
      >
        {visible.map(renderParticipant)}
        {!participants.length && (
          <div className="live-stage-message">수업에 연결하고 있어요.</div>
        )}
      </div>
      <ParticipantPagination
        {...pagination}
        total={paginated.length}
        onPageChange={pagination.setPage}
        controlsId="meeting-video-grid"
      />
    </div>
  )
}
