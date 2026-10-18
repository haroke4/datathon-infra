import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Check, Clock3, FileText } from 'lucide-react'
import { Player, type PlayerHandle } from './player'
import { formatTime } from '@/lib/format-time'
import { violationCode } from '@/lib/violation-catalog'
import type { Annotations, JobResult } from '@/lib/types'

export type ReviewPosition = { time: number; selected: number | null }
export type CompletedReview = {
  job: JobResult
  annotations: Annotations
  videoUrl: string | null
}
type Props = CompletedReview & {
  initialPosition: ReviewPosition
  onPositionChange: (id: string, position: ReviewPosition) => void
}

export const Result = memo(function Result({
  job,
  annotations,
  videoUrl,
  initialPosition,
  onPositionChange,
}: Props) {
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
            <p className="panel-hint">
              Выберите событие, чтобы перейти к фрагменту
            </p>
            <div className="violation-list" ref={list}>
              {violations.map((violation, index) => {
                const annotation = annotations.events.find(
                  (item) => item.violation_index === index
                )
                const active = selected === index
                const code = violationCode(violation)
                const sources = violation.sources?.length
                  ? violation.sources
                  : annotation?.rule?.url
                    ? [
                        {
                          label: [
                            annotation.rule.title,
                            annotation.rule.section,
                          ]
                            .filter(Boolean)
                            .join(', '),
                          url: annotation.rule.url,
                        },
                      ]
                    : []
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
                          {violation.sources?.length
                            ? violation.description.replace(
                                /\s*Норма:[\s\S]*$/,
                                ''
                              )
                            : violation.description}
                        </p>
                        <div className="rule-reference">
                          {sources.length > 0 && (
                            <span className="source-label">Источник:</span>
                          )}
                          <FileText size={14} />
                          {sources.length > 0 ? (
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
                              {violation.source_note && (
                                <p className="source-note">
                                  {violation.source_note}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span>
                              {annotation?.rule_note ||
                                'Нормативный источник не указан.'}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
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
