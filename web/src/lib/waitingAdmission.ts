/** A successful admission stays claimed until the waiting view is disposed. */
export function createWaitingAdmission<T extends { waiting: boolean }>(
  join: () => Promise<T>,
  onAdmitted: (result: T) => void,
  onError: (error: unknown) => void,
) {
  let pending = false
  let admitted = false
  let disposed = false
  return {
    async request() {
      if (pending || admitted || disposed) return
      pending = true
      try {
        const result = await join()
        if (disposed) return
        if (!result.waiting) {
          // Claim before navigating: navigation's React cleanup can run later
          // than another LIVE snapshot from the socket or polling request.
          admitted = true
          onAdmitted(result)
        }
      } catch (error) {
        if (!disposed) onError(error)
      } finally {
        pending = false
      }
    },
    dispose() { disposed = true },
  }
}
