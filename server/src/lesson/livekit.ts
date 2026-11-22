import { Injectable } from '@nestjs/common'
import { AccessToken, RoomServiceClient, WebhookReceiver, type CreateOptions } from 'livekit-server-sdk'
import { jwtVerify } from 'jose'

/** Every LiveKit call the lesson service makes. Methods are instance-replaceable for tests. */
@Injectable()
export class LiveKitAdapter {
  private readonly rooms = new RoomServiceClient(process.env.LIVEKIT_URL || 'http://livekit:7880', process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET)
  readonly receiver = new WebhookReceiver(process.env.LIVEKIT_API_KEY || '', process.env.LIVEKIT_API_SECRET || '')
  listRooms(names?: string[]) { return this.rooms.listRooms(names) }
  createRoom(options: CreateOptions) { return this.rooms.createRoom(options) }
  deleteRoom(room: string) { return this.rooms.deleteRoom(room) }
  getParticipant(room: string, identity: string) { return this.rooms.getParticipant(room, identity) }
  listParticipants(room: string) { return this.rooms.listParticipants(room) }
  removeParticipant(room: string, identity: string) { return this.rooms.removeParticipant(room, identity) }
  /** Short-lived join token bound to one admission, so a replaced or kicked admission cannot reconnect. */
  async admissionToken(room: string, user: { id: string; name: string }, admissionId: string, role: 'teacher' | 'student') {
    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: user.id, name: user.name, ttl: '2m', metadata: JSON.stringify({ admissionId, userId: user.id, role }) })
    token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: false })
    return token.toJwt()
  }
  publicUrl() { return process.env.LIVEKIT_PUBLIC_URL || `${process.env.PUBLIC_ORIGIN?.replace(/^http/, 'ws')}/livekit` }
  /** Verifies a join token presented to the signalling proxy; returns undefined when it is invalid. */
  async verifyToken(token: string): Promise<{ sub?: string; video?: { room?: string }; metadata?: string } | undefined> {
    try { return (await jwtVerify(token, new TextEncoder().encode(process.env.LIVEKIT_API_SECRET), { algorithms: ['HS256'], issuer: process.env.LIVEKIT_API_KEY })).payload as any } catch { return undefined }
  }
}

/** Parses participant/token metadata written by admissionToken; unreadable metadata matches no admission. */
export function admissionMetadata(raw?: string | null): { admissionId?: string } {
  try { return JSON.parse(raw || '{}') } catch { return {} }
}
