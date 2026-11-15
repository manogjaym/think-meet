import { io, type ManagerOptions, type Socket, type SocketOptions } from "socket.io-client"
import { CONTRACT_REVISION, SOCKET_PATH } from "../generated/contracts"
import { capabilityHeaders, requireEventFeature } from "./features"
import { isFeatureEnabled } from "./features"
import { featureForEvent, isKnownEvent } from "../generated/feature-policy"

/** Browsers send metadata in auth for WebSocket; polling also carries the HTTP headers. */
export function createAppSocket(options: Partial<ManagerOptions & SocketOptions> = {}): Socket {
  return io({ ...options, path: SOCKET_PATH, withCredentials: true, extraHeaders: { ...options.extraHeaders, ...capabilityHeaders() },
    auth: { ...(typeof options.auth === "object" ? options.auth : {}), platform: "web", contractRevision: CONTRACT_REVISION } })
}

export async function requestSocket<T>(socket: Socket, event: string, payload: Record<string, unknown>, timeoutMillis = 15_000): Promise<T> {
  await requireEventFeature(event, payload)
  if (!socket.connected) throw new Error("수업 연결을 복구하고 있어요. 연결 후 다시 시도해 주세요.")
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMillis).emit(event, payload, (timeout: Error | null, result: T) => {
      if (timeout) reject(new Error("응답을 받지 못했어요. 연결을 확인하고 다시 시도해 주세요."))
      else resolve(result)
    })
  })
}

export function emitVolatile(socket: Socket, event: string, payload: Record<string, unknown>): void {
  // Ephemeral pointer frames must never queue behind a capability lookup or a reconnect.
  if (!isKnownEvent(event, payload)) return
  const feature = featureForEvent(event, payload)
  if (feature && !isFeatureEnabled(feature)) return
  if (socket.connected) socket.volatile.emit(event, payload)
}
