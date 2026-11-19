import { useCallback, useMemo, useSyncExternalStore } from "react"
import { ParticipantEvent, RoomEvent, TrackEvent, type Participant, type Room, type Track, type TrackPublication } from "livekit-client"

const membershipEvents = [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ConnectionStateChanged]
const audioTrackEvents = [...membershipEvents, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed]
const speakerEvents = [...membershipEvents, RoomEvent.ActiveSpeakersChanged]
const playbackEvents = [RoomEvent.AudioPlaybackStatusChanged, RoomEvent.ConnectionStateChanged]
const publicationEvents = [
  ParticipantEvent.LocalTrackPublished, ParticipantEvent.LocalTrackUnpublished,
  ParticipantEvent.TrackPublished, ParticipantEvent.TrackUnpublished,
  ParticipantEvent.TrackMuted, ParticipantEvent.TrackUnmuted,
] as const

function useRoomSubscription(room: Room | null, events: RoomEvent[]) {
  return useCallback((notify: () => void) => {
    if (!room) return () => {}
    for (const event of events) room.on(event, notify)
    return () => { for (const event of events) room.off(event, notify) }
  }, [room, events])
}

function useRoomList<T>(room: Room | null, events: RoomEvent[], read: (room: Room) => T[]) {
  const subscribe = useRoomSubscription(room, events)
  const getSnapshot = useMemo(() => {
    let previous: T[] = []
    return () => {
      if (!room) return previous
      const next = read(room)
      if (next.length !== previous.length || next.some((item, i) => item !== previous[i])) previous = next
      return previous
    }
  }, [room, read])
  return useSyncExternalStore(subscribe, getSnapshot)
}

const readParticipants = (room: Room): Participant[] => [room.localParticipant, ...room.remoteParticipants.values()]
const readRemoteAudio = (room: Room) => [...room.remoteParticipants.values()].flatMap(person =>
  [...person.audioTrackPublications.values()].flatMap(publication => publication.audioTrack ? [publication.audioTrack] : []))

export function useRoomParticipants(room: Room | null) {
  return useRoomList(room, membershipEvents, readParticipants)
}

export function useRemoteAudioTracks(room: Room | null) {
  return useRoomList(room, audioTrackEvents, readRemoteAudio)
}

export function useRemoteSpeaker(room: Room | null, userId: string) {
  const subscribe = useRoomSubscription(room, speakerEvents)
  return useSyncExternalStore(subscribe, () => {
    const speaker = room?.activeSpeakers.find(person => person.identity !== userId && room.remoteParticipants.has(person.identity))
    return speaker && room?.remoteParticipants.get(speaker.identity)
  })
}

export function useAudioPlaybackBlocked(room: Room | null) {
  const subscribe = useRoomSubscription(room, playbackEvents)
  return useSyncExternalStore(subscribe, () => Boolean(room && !room.canPlaybackAudio))
}

type TrackState = { track: TrackPublication["track"]; enabled: boolean }

/** A publication can change mute state without changing its track object. */
export function useParticipantTrack(participant: Participant | undefined, source: Track.Source) {
  const subscribe = useCallback((notify: () => void) => {
    if (!participant) return () => {}
    const publicationChanged = (publication: TrackPublication) => {
      if (publication.source === source) notify()
    }
    const subscriptionChanged = (_track: Track, publication: TrackPublication) => publicationChanged(publication)
    for (const event of publicationEvents) participant.on(event, publicationChanged)
    participant.on(ParticipantEvent.TrackSubscribed, subscriptionChanged).on(ParticipantEvent.TrackUnsubscribed, subscriptionChanged)
    return () => {
      for (const event of publicationEvents) participant.off(event, publicationChanged)
      participant.off(ParticipantEvent.TrackSubscribed, subscriptionChanged).off(ParticipantEvent.TrackUnsubscribed, subscriptionChanged)
    }
  }, [participant, source])
  const getSnapshot = useMemo(() => {
    let previous: TrackState = { track: undefined, enabled: false }
    return () => {
      const publication = participant?.getTrackPublication(source)
      const track = publication?.track
      const enabled = !(publication?.isMuted ?? true)
      if (track !== previous.track || enabled !== previous.enabled) previous = { track, enabled }
      return previous
    }
  }, [participant, source])
  return useSyncExternalStore(subscribe, getSnapshot)
}

export function useParticipantSpeaking(participant: Participant | undefined) {
  const subscribe = useCallback((notify: () => void) => {
    participant?.on(ParticipantEvent.IsSpeakingChanged, notify)
    return () => { participant?.off(ParticipantEvent.IsSpeakingChanged, notify) }
  }, [participant])
  return useSyncExternalStore(subscribe, () => Boolean(participant?.isSpeaking))
}

/** An analyser binds to the underlying stream track, even when LiveKit reuses its wrapper. */
export function useMediaStreamTrack(track: Track | undefined) {
  const subscribe = useCallback((notify: () => void) => {
    track?.on(TrackEvent.Restarted, notify).on(TrackEvent.TrackProcessorUpdate, notify)
    return () => { track?.off(TrackEvent.Restarted, notify).off(TrackEvent.TrackProcessorUpdate, notify) }
  }, [track])
  return useSyncExternalStore(subscribe, () => track?.mediaStreamTrack)
}
