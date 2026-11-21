import { getDocument, GlobalWorkerOptions } from "pdfjs-dist"
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import { materialContentUrl } from "../../lib/meeting"

GlobalWorkerOptions.workerSrc = pdfWorker

export const loadMaterialPdf = (id: string, lessonId?: string) =>
  getDocument({ url: materialContentUrl(id, lessonId), withCredentials: true })
