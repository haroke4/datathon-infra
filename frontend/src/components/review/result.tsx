import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Check, Clock3, Download, FileText, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Player, type PlayerHandle } from './player'
import { ViolationDecisions } from './violation-decisions'
import { useViolationReviews } from '@/lib/use-violation-reviews'
import { api } from '@/lib/api'
import { formatTime } from '@/lib/format-time'
import { violationCode } from '@/lib/violation-catalog'
import { eventDescription, eventSources } from '@/lib/review-event'
import {
  EMPTY_REVIEW_NOTE,
  readReviewNotes,
  reviewNoteKey,
  saveReviewNotes,
  type ReviewNote,
} from '@/lib/review-notes'
import type { Annotations, JobResult } from '@/lib/types'

export type ReviewPosition = { time: number; selected: number | null }
export type CompletedReview = {
  job: JobResult
  annotations: Annotations
  videoUrl: string | null
}
type Props = CompletedReview & {
  filename: string
  createdAt?: string
  initialPosition: ReviewPosition
  onPositionChange: (id: string, position: ReviewPosition) => void
}

export const Result = memo(function Result({
  job,
  annotations,
  videoUrl,
  filename,
  createdAt,
  initialPosition,
  onPositionChange,
}: Props) {
  const [notes, setNotes] = useState(() => readReviewNotes(job.job_id))
  const notesRef = useRef(notes)
  const [exporting, setExporting] = useState(false)
  const exportBusy = useRef(false)
  const [exportError, setExportError] = useState('')
  const [selected, setSelected] = useState<number | null>(
    initialPosition.selected
  )
  const selectedRef = useRef(initialPosition.selected)
  // Decided once on open: a review left at the very beginning starts at its first violation.
  const [autoSkip] = useState(() => initialPosition.time < 0.05)
  const player = useRef<PlayerHandle>(null)
  const list = useRef<HTMLDivElement>(null)
  const cards = useRef<(HTMLButtonElement | null)[]>([])
  const violations = job.violations || []
  const decisions = useViolationReviews(job.job_id, violations.length)
  const onTimeChange = useCallback(
    (time: number) => {
      const visible = annotations.events.filter(
        (item) => time >= item.start_sec && time <= item.end_sec
      )
      const event =
        visible.find((item) => item.violation_index === selectedRef.current) ||
        visible[0]
      if (event && event.violation_index !== selectedRef.current) {
        selectedRef.current = event.violation_index
        setSelected(event.violation_index)
      }
      onPositionChange(job.job_id, { time, selected: selectedRef.current })
    },
    [annotations, job.job_id, onPositionChange]
  )

  // Scroll only the event list, never move the whole page during playback.
  useEffect(() => {
    const container = list.current
    const card =
      selected === null
        ? null
        : cards.current[selected]?.closest('.violation-card')
    if (!container || !card || container.scrollHeight <= container.clientHeight)
      return
    const bounds = container.getBoundingClientRect()
    const target = card.getBoundingClientRect()
    const delta =
      target.bottom > bounds.bottom
        ? target.bottom - bounds.bottom + 8
        : target.top < bounds.top
          ? target.top - bounds.top - 8
          : 0
    if (delta)
      container.scrollBy({
        top: delta,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      })
  }, [selected])

  const select = (index: number) => {
    selectedRef.current = index
    setSelected(index)
    player.current?.seek(violations[index].timecode_sec)
  }
  const updateNote = (key: string, patch: Partial<ReviewNote>) => {
    const next = {
      ...notesRef.current,
      [key]: { ...(notesRef.current[key] || EMPTY_REVIEW_NOTE), ...patch },
    }
    notesRef.current = next
    setNotes(next)
    saveReviewNotes(job.job_id, next)
  }
  const download = async () => {
    if (exportBusy.current) return
    exportBusy.current = true
    setExporting(true)
    setExportError('')
    try {
      const reportNotes = { ...notesRef.current }
      if (violations.length) {
        const current = await api.reviews(job.job_id)
        if (current.reviews.length !== violations.length)
          throw new Error('Результат изменился')
        for (const review of current.reviews) {
          const key = reviewNoteKey(
            violations[review.violation_index],
            review.violation_index
          )
          reportNotes[key] = {
            ...(reportNotes[key] || EMPTY_REVIEW_NOTE),
            decision: review.decision,
          }
        }
      }
      const { downloadReviewPdf } = await import('@/lib/review-report')
      await downloadReviewPdf({
        job,
        annotations,
        filename,
        createdAt,
        notes: reportNotes,
      })
    } catch {
      setExportError('Не удалось собрать PDF. Попробуйте ещё раз.')
    } finally {
      exportBusy.current = false
      setExporting(false)
    }
  }
  const exportButton = (
    <div className="review-export">
      <Button
        variant="outline"
        className="review-export-button"
        onClick={download}
        disabled={exporting || decisions.pending.size > 0}
      >
        {exporting ? (
          <LoaderCircle size={14} className="animate-spin" />
        ) : (
          <Download size={14} />
        )}
        {exporting ? 'Собираем PDF…' : 'Скачать PDF'}
      </Button>
      {exportError && (
        <p className="review-export-error" role="alert">
          {exportError}
        </p>
      )}
    </div>
  )
  const clean = job.verdict === 'no_violation'
  return (
    <div className="review-layout">
      <Player
        ref={player}
        videoUrl={videoUrl}
        duration={annotations.duration_sec}
        violations={violations}
        annotations={annotations.events}
        initialTime={initialPosition.time}
        autoSkip={autoSkip}
        onTimeChange={onTimeChange}
      />
      <aside
        className={`violations-panel ${clean ? 'is-clean' : ''}`}
        aria-label="Результат проверки"
      >
        {clean ? (
          <div className="empty-result">
            <span className="success-icon">
              <Check size={24} strokeWidth={2} />
            </span>
            <h1>
              Возможных нарушений
              <br />
              не обнаружено
            </h1>
            <p>
              В этой записи нет признаков
              <br />
              возможных нарушений.
            </p>
          </div>
        ) : (
          <>
            <div className="violations-heading">
              <h1>Возможные нарушения</h1>
              <span className="count-badge">{violations.length}</span>
            </div>
            {exportButton}
            <div className="violation-list" ref={list}>
              {violations.map((violation, index) => {
                const annotation = annotations.events.find(
                  (item) => item.violation_index === index
                )
                const active = selected === index
                const code = violationCode(violation)
                const sources = eventSources(violation, annotation)
                const noteKey = reviewNoteKey(violation, index)
                const note = notes[noteKey] || EMPTY_REVIEW_NOTE
                return (
                  <div
                    key={index}
                    className={`violation-card ${active ? 'selected' : ''}`}
                  >
                    <button
                      ref={(element) => {
                        cards.current[index] = element
                      }}
                      className="violation-select"
                      onClick={() => select(index)}
                      aria-pressed={active}
                      aria-label={[
                        formatTime(violation.timecode_sec),
                        code,
                        violation.type,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-expanded={active}
                      aria-controls={`event-details-${index}`}
                      aria-describedby={`event-seek-hint-${index}`}
                    >
                      <span className="event-meta">
                        <span className="violation-time">
                          <Clock3 size={13} />
                          {formatTime(violation.timecode_sec)}
                        </span>
                        <span
                          id={`event-seek-hint-${index}`}
                          className="event-seek-hint"
                        >
                          Перейти к моменту
                        </span>
                      </span>
                      <span className="violation-title">
                        {code && <span className="violation-code">{code}</span>}
                        {violation.type}
                      </span>
                    </button>
                    {active && (
                      <div
                        id={`event-details-${index}`}
                        className="event-details"
                      >
                        <p className="violation-description">
                          {eventDescription(violation, annotation)}
                        </p>
                        {sources.length > 0 && (
                          <div className="rule-reference">
                            <span className="source-label">Источники</span>
                            <FileText size={14} />
                            <div className="source-list" aria-label="Источники">
                              {sources.map((source) => (
                                <a
                                  key={`${source.label}-${source.url}`}
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {source.label}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <ViolationDecisions
                      index={index}
                      review={decisions.reviews.find(
                        (item) => item.violation_index === index
                      )}
                      loading={decisions.loading}
                      saving={decisions.pending.has(index)}
                      error={decisions.errors[index] || ''}
                      loadError={decisions.error}
                      onSave={(decision) =>
                        void decisions.save(index, decision)
                      }
                      onRetry={decisions.retry}
                    >
                      <div className="review-note">
                        <label htmlFor={`review-comment-${index}`}>
                          Заметка
                        </label>
                        <textarea
                          id={`review-comment-${index}`}
                          rows={2}
                          maxLength={5000}
                          value={note.comment}
                          placeholder="Добавьте заметку"
                          onChange={(event) =>
                            updateNote(noteKey, { comment: event.target.value })
                          }
                        />
                      </div>
                    </ViolationDecisions>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </aside>
    </div>
  )
})
