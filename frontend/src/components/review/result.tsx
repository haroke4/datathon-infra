import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Check, CircleCheck, Clock3, FileText } from 'lucide-react'
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
              Нарушений
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
                    >
                      <span className="event-meta">
                        <span className="violation-time">
                          <Clock3 size={13} />
                          {formatTime(violation.timecode_sec)}
                        </span>
                        {active && (
                          <CircleCheck size={16} className="event-selected" />
                        )}
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
                          {violation.description}
                        </p>
                        <div className="rule-reference">
                          <FileText size={14} />
                          {annotation?.rule ? (
                            <span>
                              {annotation.rule.title}
                              <small>{annotation.rule.section}</small>
                            </span>
                          ) : (
                            <span>
                              {annotation?.rule_note ||
                                'Нормативный источник не указан.'}
                            </span>
                          )}
                        </div>
                        {violation.evidence_frames.length > 0 && (
                          <div className="evidence-frames">
                            {violation.evidence_frames.map((frame, i) => (
                              <img
                                key={i}
                                loading="lazy"
                                src={`data:image/jpeg;base64,${frame.image_base64}`}
                                alt={`Кадр-доказательство ${formatTime(frame.timestamp_sec)}`}
                              />
                            ))}
                          </div>
                        )}
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
