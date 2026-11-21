import { useEffect, useState } from "react"
import type { PrejoinStatus } from "../generated/contracts"
import { designContent as copy } from "../generated/design-content"
import { api, ApiError } from "./api"

export const prejoinFeature = "classroom.prejoin"
const refreshMillis = 5_000

export type PrejoinProbe = { state: "checking" } | {
  state: "connected"
  result: PrejoinStatus
  millis: number
} | { state: "failed"; error?: ApiError }

export function usePrejoinProbe(
  lessonId: string,
  enabled: boolean,
  retry: number,
) {
  const [probe, setProbe] = useState<PrejoinProbe>({ state: "checking" })
  useEffect(() => {
    if (!enabled) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    let request: AbortController | undefined
    const check = async () => {
      request = new AbortController()
      const timeout = setTimeout(() => request?.abort(), 4_000)
      const start = performance.now()
      try {
        const result = await api<PrejoinStatus>(
          `/lessons/${lessonId}/prejoin`,
          { signal: request.signal },
        )
        if (active)
          setProbe({
            state: "connected",
            result,
            millis: Math.round(performance.now() - start),
          })
        if (result.status === "ENDED" || result.status === "CANCELLED") return
      } catch (error) {
        if (active)
          setProbe({
            state: "failed",
            error: error instanceof ApiError ? error : undefined,
          })
        if (error instanceof ApiError && [401, 403, 404].includes(error.status))
          return
      } finally {
        clearTimeout(timeout)
      }
      if (active) timer = setTimeout(check, refreshMillis)
    }
    setProbe({ state: "checking" })
    void check()
    return () => {
      active = false
      request?.abort()
      clearTimeout(timer)
    }
  }, [lessonId, enabled, retry])
  return probe
}

function startPrejoinWait(lessonId: string) {
  const path = `/lessons/${lessonId}/waiting/${crypto.randomUUID()}`
  let active = true
  let timer: ReturnType<typeof setTimeout>
  let renewal: Promise<void>
  const renew = () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4_000)
    renewal = api(path, { method: "PUT", signal: controller.signal })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout)
        if (active) timer = setTimeout(renew, refreshMillis)
      })
  }
  const release = () => {
    if (!active) return
    active = false
    clearTimeout(timer)
    void renewal
      .then(() => api(path, { method: "DELETE", keepalive: true }))
      .catch(() => {})
  }
  renew()
  return release
}

export function registerPrejoinWait(lessonId: string) {
  let release: (() => void) | undefined = startPrejoinWait(lessonId)
  const pageHide = () => {
    release?.()
    release = undefined
  }
  const pageShow = () => {
    release ??= startPrejoinWait(lessonId)
  }
  window.addEventListener("pagehide", pageHide)
  window.addEventListener("pageshow", pageShow)
  return () => {
    window.removeEventListener("pagehide", pageHide)
    window.removeEventListener("pageshow", pageShow)
    pageHide()
  }
}

export function prejoinMediaError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError")
      return copy.prejoinPermission
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError")
      return copy.prejoinUnavailable
  }
  return copy.prejoinFailed
}

/** Generate a short, quiet PCM tone so the ordinary media element can select an output. */
export function prejoinTestTone() {
  const rate = 16_000
  const length = Math.round(rate * 0.65)
  const pcm = new DataView(new ArrayBuffer(44 + length * 2))
  const tag = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      pcm.setUint8(offset + i, value.charCodeAt(i))
  }
  tag(0, "RIFF")
  pcm.setUint32(4, 36 + length * 2, true)
  tag(8, "WAVE")
  tag(12, "fmt ")
  pcm.setUint32(16, 16, true)
  pcm.setUint16(20, 1, true)
  pcm.setUint16(22, 1, true)
  pcm.setUint32(24, rate, true)
  pcm.setUint32(28, rate * 2, true)
  pcm.setUint16(32, 2, true)
  pcm.setUint16(34, 16, true)
  tag(36, "data")
  pcm.setUint32(40, length * 2, true)
  for (let i = 0; i < length; i++) {
    const fade = Math.min(1, i / 320, (length - 1 - i) / 320)
    pcm.setInt16(
      44 + i * 2,
      Math.round(4000 * fade * Math.sin((2 * Math.PI * 440 * i) / rate)),
      true,
    )
  }
  return new Blob([pcm.buffer], { type: "audio/wav" })
}
