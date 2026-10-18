import { jsPDF } from 'jspdf'
import fontUrl from '../assets/NotoSans-Regular.ttf?url'
import { formatTime } from './format-time'
import { violationCode } from './violation-catalog'
import { eventDescription, eventSources } from './review-event'
import {
  EMPTY_REVIEW_NOTE,
  REVIEW_DECISIONS,
  reviewNoteKey,
  type ReviewNotes,
} from './review-notes'
import type { Annotations, JobResult } from './types'

type ReportInput = {
  job: JobResult
  annotations: Annotations
  filename: string
  createdAt?: string
  notes: ReviewNotes
}

let font: Promise<string> | undefined
async function loadFont() {
  font ??= fetch(fontUrl, { signal: AbortSignal.timeout(20000) })
    .then(async (response) => {
      if (!response.ok) throw new Error('Не удалось загрузить шрифт отчёта.')
      const bytes = new Uint8Array(await response.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      return btoa(binary)
    })
    .catch((error) => {
      font = undefined
      throw error
    })
  return font
}

// Layout in points with embedded Cyrillic font, searchable text and live source links.
export function createReviewPdf(input: ReportInput, fontBase64: string) {
  const doc = new jsPDF({
    unit: 'pt',
    format: 'a4',
    compress: true,
    putOnlyUsedFonts: true,
  })
  doc.addFileToVFS('NotoSans.ttf', fontBase64)
  doc.addFont('NotoSans.ttf', 'NotoSans', 'normal')
  doc.setFont('NotoSans')
  doc.setProperties({
    title: `Материалы проверки — ${input.filename}`,
    subject: 'Проверка кассовой дисциплины',
    creator: 'Forte Review',
  })
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const margin = 44
  const contentWidth = width - margin * 2
  let y = margin
  const newPage = () => {
    doc.addPage()
    y = margin
  }
  const ensure = (space: number) => {
    if (y + space > height - margin) newPage()
  }
  const text = (value: string, size = 10, color = '#333333', url?: string) => {
    doc.setFontSize(size)
    doc.setTextColor(color)
    const lines: string[] = doc.splitTextToSize(value, contentWidth)
    const lineHeight = size * 1.5
    for (const line of lines) {
      ensure(lineHeight)
      doc.text(line, margin, y + size)
      if (url && /^https?:\/\//i.test(url))
        doc.link(
          margin,
          y,
          Math.min(contentWidth, doc.getTextWidth(line)),
          lineHeight,
          { url }
        )
      y += lineHeight
    }
    y += 5
  }
  const label = (value: string) => {
    ensure(45)
    text(value, 9, '#777777')
  }
  const violations = input.job.violations || []
  text('Материалы проверки', 22, '#25212a')
  y += 7
  text(input.filename, 12)
  if (input.createdAt)
    text(
      `Проверка: ${new Date(input.createdAt).toLocaleString('ru-RU')}`,
      9,
      '#777777'
    )
  text(`ID: ${input.job.job_id}`, 8, '#777777')
  text(`Сформировано: ${new Date().toLocaleString('ru-RU')}`, 9, '#777777')
  text(
    `Возможных нарушений: ${violations.length} · Длительность видео: ${formatTime(input.annotations.duration_sec)}`,
    10
  )
  if (!violations.length) {
    y += 14
    text('Возможных нарушений не обнаружено.', 13, '#397e52')
  }
  for (const [index, violation] of violations.entries()) {
    // Each event starts on a fresh page when the summary leaves little room.
    ensure(190)
    y += 14
    doc.setDrawColor('#e5e5e5')
    doc.line(margin, y, width - margin, y)
    y += 16
    const annotation = input.annotations.events.find(
      (item) => item.violation_index === index
    )
    const note =
      input.notes[reviewNoteKey(violation, index)] || EMPTY_REVIEW_NOTE
    text(
      `Событие ${index + 1} · ${formatTime(violation.timecode_sec)}`,
      10,
      '#6d28a8'
    )
    text(
      [violationCode(violation), violation.type].filter(Boolean).join(' · '),
      14
    )
    label('Пояснение')
    text(eventDescription(violation, annotation) || 'Пояснение не указано.')
    label('Нормативные источники')
    const sources = eventSources(violation, annotation)
    if (!sources.length) text('Нормативный источник не указан.', 10, '#777777')
    for (const source of sources) text(source.label, 10, '#6d28a8', source.url)
    label('Решение проверяющего')
    text(REVIEW_DECISIONS[note.decision])
    label('Комментарий')
    text(note.comment.trim() || 'Не добавлен.')
    label('Кадры события')
    if (!violation.evidence_frames?.length)
      text('Кадры не предоставлены.', 10, '#777777')
    for (const [frameIndex, frame] of (
      violation.evidence_frames || []
    ).entries()) {
      try {
        // API frames are JPEG base64 without a data URL prefix.
        const data = frame.image_base64.startsWith('data:')
          ? frame.image_base64
          : `data:image/jpeg;base64,${frame.image_base64}`
        const image = doc.getImageProperties(data)
        if (!(image.width > 0 && image.height > 0))
          throw new Error('Invalid frame')
        const scale = Math.min(contentWidth / image.width, 245 / image.height)
        const imageWidth = image.width * scale
        const imageHeight = image.height * scale
        ensure(imageHeight + 38)
        doc.addImage(
          data,
          image.fileType,
          margin,
          y,
          imageWidth,
          imageHeight,
          undefined,
          'FAST'
        )
        y += imageHeight + 5
        text(
          `Кадр ${frameIndex + 1} · ${formatTime(frame.timestamp_sec)}`,
          8,
          '#777777'
        )
      } catch {
        text(
          `Кадр ${frameIndex + 1} · ${formatTime(frame.timestamp_sec)} — изображение недоступно.`,
          9,
          '#777777'
        )
      }
    }
  }
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setFontSize(8)
    doc.setTextColor('#888888')
    doc.text('Forte · Материалы проверки', margin, height - 22)
    doc.text(`${page} / ${pages}`, width - margin, height - 22, {
      align: 'right',
    })
  }
  return doc
}

export async function downloadReviewPdf(input: ReportInput) {
  const doc = createReviewPdf(input, await loadFont())
  const basename =
    input.filename
      .replace(/\.[^.]+$/, '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .slice(0, 100) || input.job.job_id
  await doc.save(`${basename}-report.pdf`, { returnPromise: true })
}
