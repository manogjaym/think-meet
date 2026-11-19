import { Track, type LocalTrack, type Room } from "livekit-client"
import type { Share } from "../generated/contracts.ts"

const sources = [Track.Source.ScreenShare, Track.Source.ScreenShareAudio]

type ShareLink = {
  start: () => Promise<Share | null | undefined>
  stop: (expectedShareId?: string) => Promise<unknown>
  connected: () => boolean
  guardedStop: () => boolean
  report: (error: unknown) => void
}

/** Owns one browser capture and binds it to the share ID returned by the server. */
export class ScreenShareSession {
  private tracks = new Set<LocalTrack>()
  private video?: MediaStreamTrack
  private currentShare?: Share | null
  private ownedId?: string
  private pendingStop?: string
  private sendingStop?: string
  private retryOnCompletion = false
  private starting = false
  private cancelledStart = false
  private cleanup?: Promise<void>
  private closed = false
  private room: Room
  private userId: string
  private link: ShareLink

  constructor(room: Room, userId: string, link: ShareLink) {
    this.room = room
    this.userId = userId
    this.link = link
  }

  observeShare(share: Share | null | undefined) {
    this.currentShare = share
    if (this.pendingStop !== share?.id) this.pendingStop = undefined
    if (this.ownedId && this.ownedId !== share?.id) {
      this.ownedId = undefined
      void this.releaseCapture()
    }
  }

  published(source: Track.Source, track?: LocalTrack) {
    if (!track || !sources.includes(source)) return
    if (this.closed || this.cleanup || (!this.starting && !this.ownedId) || this.cancelledStart || track.mediaStreamTrack.readyState === "ended") {
      track.stop()
      void this.room.localParticipant.unpublishTrack(track, false).catch(error => this.report(error))
      return
    }
    this.tracks.add(track)
    if (source === Track.Source.ScreenShare && this.video !== track.mediaStreamTrack) {
      this.unobserveVideo()
      this.video = track.mediaStreamTrack
      this.video.addEventListener("ended", this.captureEnded, { once: true })
    }
  }

  async start(target: "browser" | "screen") {
    if (this.closed || this.starting || this.ownedId || this.cleanup) return
    this.starting = true
    this.cancelledStart = false
    try {
      await this.room.localParticipant.setScreenShareEnabled(true, {
        audio: true, video: { displaySurface: target === "browser" ? "browser" : "monitor" },
        systemAudio: "include", surfaceSwitching: "include",
      })
      if (this.closed || this.cancelledStart || this.video?.readyState !== "live") {
        await this.releaseCapture()
        return
      }
      const share = await this.link.start()
      if (this.closed || share?.type !== "screen" || share.ownerId !== this.userId || share.assistanceId || this.currentShare?.id !== share.id) {
        await this.releaseCapture()
        return
      }
      this.ownedId = share.id
      if (this.cancelledStart || this.video?.readyState !== "live") this.captureEnded()
    } catch (error) {
      await this.releaseCapture()
      if (!(error instanceof DOMException && error.name === "NotAllowedError")) this.report(error)
    } finally { this.starting = false }
  }

  stop(share: Share | null | undefined) {
    if (this.closed || !share || this.currentShare?.id !== share.id) return
    if (this.ownedId === share.id || (this.starting && share.type === "screen" && share.ownerId === this.userId && !share.assistanceId)) {
      this.ownedId = undefined
      this.cancelledStart = true
      void this.releaseCapture()
    }
    this.requestStop(share.id, true)
  }

  mediaReconnected() {
    // Full reconnect can remove publications temporarily. Only inspect the completed reconnect.
    if (this.ownedId && !this.room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track) this.captureEnded()
  }

  controlReconnected() {
    if (this.sendingStop) this.retryOnCompletion = true
    else this.flushStop()
  }

  close() {
    this.closed = true
    this.cancelledStart = true
    this.pendingStop = undefined
    void this.releaseCapture()
  }

  private captureEnded = () => {
    if (this.closed) return
    const id = this.ownedId
    this.ownedId = undefined
    this.cancelledStart = true
    void this.releaseCapture()
    if (id && this.currentShare?.id === id) this.requestStop(id, false)
  }

  private requestStop(id: string, explicit: boolean) {
    const guarded = this.link.guardedStop()
    if (guarded || !explicit) this.pendingStop = id
    this.flushStop(explicit && !guarded ? id : undefined)
  }

  private flushStop(legacyId?: string) {
    const id = legacyId ?? this.pendingStop
    if (this.closed || !id || this.currentShare?.id !== id || this.sendingStop || (!legacyId && !this.link.guardedStop())) return
    if (!this.link.connected()) {
      if (legacyId) this.report(new Error("수업 연결을 복구하고 있어요. 연결 후 다시 시도해 주세요."))
      return
    }
    this.sendingStop = id
    void this.link.stop(legacyId ? undefined : id).then(() => {
      if (this.pendingStop === id) this.pendingStop = undefined
    }).catch(error => this.report(error)).finally(() => {
      this.sendingStop = undefined
      const retry = this.retryOnCompletion
      this.retryOnCompletion = false
      if (retry || this.pendingStop && this.pendingStop !== id) this.flushStop()
    })
  }

  private unobserveVideo() {
    this.video?.removeEventListener("ended", this.captureEnded)
    this.video = undefined
  }

  private releaseCapture(): Promise<void> {
    if (this.cleanup) return this.cleanup
    this.unobserveVideo()
    const participant = this.room.localParticipant
    const published = sources.flatMap(source => {
      const track = participant.getTrackPublication(source)?.track
      return track ? [track] : []
    })
    const captures = new Set([...this.tracks.values(), ...published])
    this.tracks.clear()
    if (!captures.size) return Promise.resolve()
    for (const track of captures) track.stop()
    this.cleanup = Promise.allSettled(published.map(track => participant.unpublishTrack(track, false))).then(results => {
      for (const result of results) if (result.status === "rejected") this.report(result.reason)
    }).finally(() => { this.cleanup = undefined })
    return this.cleanup
  }

  private report(error: unknown) { if (!this.closed) this.link.report(error) }
}
