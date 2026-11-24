import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist"
import { designContent as copy } from "../../generated/design-content"
import type { Material, Share } from "../../lib/meeting"
import { Icon } from "../ui"
import { loadMaterialPdf } from "./pdfDocument"

type Props = {
  materials: Material[]
  share: Share | null | undefined
  busy: boolean
  connected: boolean
  /** Tags materials without a subject; only set when the lesson has a subject. */
  markUnclassified?: boolean
  onOpen: (id: string, page: number) => Promise<void>
  onDelete: (material: Material) => Promise<void>
}

export function TextbookPicker({ materials, share, busy, connected, markUnclassified = false, onOpen, onDelete }: Props) {
  const [selection, setSelection] = useState<{ id: string; page: number }>()
  const material = materials.find(item => item.id === selection?.id)
    ?? materials.find(item => item.id === share?.materialId) ?? materials[0]
  const page = selection && selection.id === material?.id ? selection.page
    : material?.id === share?.materialId ? share?.page ?? 1 : 1

  if (!material) return <p className="chat-notice">{copy.textbookEmpty}</p>
  return <>
    <div className="textbook-select">
      <select aria-label={copy.textbookSelect} disabled={busy} value={material.id}
        onChange={event => setSelection({ id: event.target.value, page: 1 })}>
        {materials.map(item => <option value={item.id} key={item.id}>
          {markUnclassified && !item.subject ? `${item.name} · ${copy.subjectUnclassified}` : item.name}
        </option>)}
      </select>
      {markUnclassified && !material.subject && <em className="subject-tag">{copy.subjectUnclassified}</em>}
      <button className="content-delete" disabled={busy || share?.materialId === material.id} aria-label={`${material.name} 삭제`}
        onClick={() => void onDelete(material)}><Icon name="trash" size={17} /></button>
    </div>
    <TextbookPages key={material.id} material={material} page={page} busy={busy} connected={connected}
      onSelect={page => setSelection({ id: material.id, page })}
      onOpen={page => { setSelection({ id: material.id, page }); return onOpen(material.id, page) }} />
  </>
}

function TextbookPages({ material, page, busy, connected, onSelect, onOpen }: {
  material: Material
  page: number
  busy: boolean
  connected: boolean
  onSelect: (page: number) => void
  onOpen: (page: number) => Promise<void>
}) {
  const [attempt, setAttempt] = useState(0)
  const [pdf, setPdf] = useState<PDFDocumentProxy>()
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState<Set<number>>(() => new Set())
  const grid = useRef<HTMLDivElement>(null)
  const initialPage = useRef(page)
  useEffect(() => {
    let active = true
    const task = loadMaterialPdf(material.id)
    void task.promise.then(document => { if (active) setPdf(document) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false; void task.destroy().catch(() => {}) }
  }, [material.id, attempt])
  useLayoutEffect(() => {
    const root = grid.current
    if (!pdf || !root) return
    const cards = root.querySelectorAll<HTMLButtonElement>("[data-textbook-page]")
    cards[initialPage.current - 1]?.scrollIntoView({ block: "nearest" })
    const observer = new IntersectionObserver(entries => {
      setVisible(previous => {
        const next = new Set(previous)
        for (const entry of entries) {
          const number = Number((entry.target as HTMLButtonElement).dataset.textbookPage)
          if (entry.isIntersecting) next.add(number)
          else next.delete(number)
        }
        return next
      })
    }, { root })
    for (const card of cards) observer.observe(card)
    return () => observer.disconnect()
  }, [pdf])
  const count = Math.min(pdf?.numPages ?? 0, material.pages ?? 1)
  const selected = Math.min(page, Math.max(1, count))
  const retry = () => {
    initialPage.current = page
    setPdf(undefined); setFailed(false); setVisible(new Set()); setAttempt(value => value + 1)
  }

  return <>
    {failed && <div className="panel-error" role="alert">
      <p>{copy.textbookPreviewError}</p><button className="textbook-retry" onClick={retry}>{copy.textbookRetry}</button>
    </div>}
    {!pdf && !failed && <p className="chat-notice" role="status">{copy.textbookPreviewLoading}</p>}
    {pdf && <div className="textbook-pages" ref={grid}>
      {Array.from({ length: count }, (_, index) => {
        const number = index + 1
        return <button className="textbook-page" data-textbook-page={number} key={number}
          aria-pressed={selected === number} disabled={busy} onClick={() => onSelect(number)}>
          <div className="textbook-thumbnail">
            {visible.has(number) && <TextbookThumbnail pdf={pdf} page={number} onError={() => setFailed(true)} />}
          </div>
          <span>{copy.textbookPage.replace("{page}", String(number))}</span>
        </button>
      })}
    </div>}
    <button className="primary textbook-open" disabled={!pdf || !count || busy || !connected}
      onClick={() => void onOpen(selected)}>{copy.textbookOpenPage.replace("{page}", String(selected))}</button>
  </>
}

function TextbookThumbnail({ pdf, page, onError }: { pdf: PDFDocumentProxy; page: number; onError: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const report = useRef(onError)
  report.current = onError
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let active = true
    let render: RenderTask | undefined
    void pdf.getPage(page).then(source => {
      if (!active) return
      const original = source.getViewport({ scale: 1 })
      const viewport = source.getViewport({ scale: 240 / Math.max(original.width, original.height) })
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      render = source.render({ canvas, viewport })
      return render.promise
    }).catch(() => { if (active) report.current() })
    return () => { active = false; render?.cancel() }
  }, [pdf, page])
  return <canvas ref={ref} aria-hidden="true" />
}
