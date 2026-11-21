import type { Stroke } from "../../lib/meeting"

export function captureSharedFrame(source: HTMLCanvasElement | HTMLVideoElement, strokes: Stroke[], displayWidth: number): Promise<Blob> {
  const dimensions = source instanceof HTMLVideoElement ? [source.videoWidth, source.videoHeight] : [source.width, source.height]
  const [width, height] = dimensions
  if (width <= 0 || height <= 0 || displayWidth <= 0) throw new Error("공유 화면을 불러오는 중이에요.")
  const scale = Math.min(1, 2560 / Math.max(width, height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext("2d", { alpha: false })
  if (!context) throw new Error("공유 화면의 이미지를 만들지 못했어요.")
  context.fillStyle = "white"
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  context.lineCap = "round"
  context.lineJoin = "round"
  for (const stroke of strokes) {
    if (!stroke.points.length) continue
    const highlighter = stroke.tool === "highlighter"
    context.strokeStyle = stroke.color
    context.lineWidth = (highlighter ? 18 : 4) * canvas.width / displayWidth
    context.globalAlpha = highlighter ? .38 : 1
    context.beginPath()
    stroke.points.forEach(({ x, y }, index) => {
      if (index) context.lineTo(x * canvas.width, y * canvas.height)
      else context.moveTo(x * canvas.width, y * canvas.height)
    })
    context.stroke()
  }
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob?.size) resolve(blob)
    else reject(new Error("공유 화면의 이미지를 만들지 못했어요."))
  }, "image/jpeg", .92))
}
