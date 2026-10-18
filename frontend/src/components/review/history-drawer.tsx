import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  Clock3,
  Film,
  LoaderCircle,
  PanelLeftClose,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isMock } from '@/lib/api'
import { readViewedJobs, writePreference } from '@/lib/preferences'
import type { JobSummary } from '@/lib/types'

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const clockFormat = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
})
const statusLabel = (job: JobSummary, viewed: boolean) =>
  job.status === 'done'
    ? viewed
      ? ''
      : 'Готово'
    : job.status === 'failed'
      ? 'Ошибка'
      : job.queue_position > 0
        ? 'В очереди'
        : 'Обработка'

type Props = {
  open: boolean
  mobile: boolean
  jobs: JobSummary[]
  selectedId: string | null
  loading: boolean
  error: string
  onClose: () => void
  onSelect: (id: string) => void
  onUpload: () => void
  onRetry: () => void
}
export function HistoryDrawer({
  open,
  mobile,
  jobs,
  selectedId,
  loading,
  error,
  onClose,
  onSelect,
  onUpload,
  onRetry,
}: Props) {
  const panel = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [viewedJobs, setViewedJobs] = useState(readViewedJobs)
  const markViewed = useCallback((id: string) => {
    setViewedJobs((previous) =>
      previous.has(id) ? previous : new Set([...previous, id])
    )
  }, [])
  useEffect(() => {
    writePreference('forte.viewed-jobs', JSON.stringify([...viewedJobs]))
  }, [viewedJobs])
  useEffect(() => {
    // A video that finishes while the user is watching it is already viewed.
    if (
      selectedId &&
      jobs.some((job) => job.job_id === selectedId && job.status === 'done')
    )
      markViewed(selectedId)
  }, [jobs, selectedId, markViewed])
  useEffect(() => {
    if (!open || !mobile) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus({ preventScroll: true })
    return () => {
      document.body.style.overflow = overflow
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [open, mobile])
  const groups = jobs.reduce<Record<string, JobSummary[]>>((result, job) => {
    const key = dateFormat.format(new Date(job.created_at))
    ;(result[key] ||= []).push(job)
    return result
  }, {})
  return (
    <>
      {open && mobile && (
        <button
          className="drawer-backdrop"
          onClick={onClose}
          tabIndex={-1}
          aria-label="Закрыть историю"
        />
      )}
      <aside
        id="history-drawer"
        ref={panel}
        className="history-drawer"
        hidden={!open}
        role={mobile ? 'dialog' : undefined}
        aria-modal={mobile && open ? true : undefined}
        aria-labelledby="history-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
          if (event.key !== 'Tab' || !mobile) return
          const targets = panel.current?.querySelectorAll<HTMLButtonElement>(
            'button:not(:disabled)'
          )
          if (!targets?.length) return
          const first = targets[0],
            last = targets[targets.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <div className="drawer-heading">
          <span className="drawer-logo">
            <Film size={18} />
          </span>
          <h2 id="history-title">История проверок</h2>
          <Button
            ref={closeButton}
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Закрыть историю"
          >
            <PanelLeftClose size={19} />
          </Button>
        </div>
        <div className="drawer-actions">
          <Button
            variant="ghost"
            className="new-upload"
            onClick={onUpload}
            aria-current={!selectedId ? 'page' : undefined}
          >
            <Upload size={16} />
            Загрузить видео
          </Button>
        </div>
        <div className="history-groups" aria-busy={loading}>
          {loading && (
            <div
              className="history-skeleton"
              role="status"
              aria-label="Загружаем историю"
            >
              <span />
              <span />
              <span />
            </div>
          )}
          {error && (
            <div className="history-error" role="status">
              <p>{error}</p>
              <Button variant="link" onClick={onRetry}>
                Повторить
              </Button>
            </div>
          )}
          {!loading &&
            Object.entries(groups).map(([date, items]) => (
              <section className="history-group" key={date}>
                <h3>{date}</h3>
                {items.map((item) => (
                  <button
                    key={item.job_id}
                    className={`history-row ${selectedId === item.job_id ? 'active' : ''}`}
                    onClick={() => {
                      if (item.status === 'done') markViewed(item.job_id)
                      onSelect(item.job_id)
                    }}
                    aria-current={
                      selectedId === item.job_id ? 'true' : undefined
                    }
                    aria-label={[
                      date,
                      clockFormat.format(new Date(item.created_at)),
                      statusLabel(item, viewedJobs.has(item.job_id)),
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  >
                    <span className="history-row-top">
                      <time dateTime={item.created_at}>
                        {clockFormat.format(new Date(item.created_at))}
                      </time>
                      {(item.status !== 'done' ||
                        !viewedJobs.has(item.job_id)) && (
                        <span
                          className={`history-status status-${item.status} ${item.queue_position > 0 ? 'is-queued' : ''}`}
                        >
                          {item.status === 'done' ? (
                            <Check size={11} />
                          ) : item.status === 'processing' ? (
                            item.queue_position > 0 ? (
                              <Clock3 size={11} />
                            ) : (
                              <LoaderCircle
                                size={11}
                                className="animate-spin"
                              />
                            )
                          ) : (
                            <X size={11} />
                          )}
                          {statusLabel(item, viewedJobs.has(item.job_id))}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </section>
            ))}
          {!loading && !jobs.length && !error && (
            <div className="history-empty">
              <Film size={24} />
              <p>Проверок пока нет</p>
              <span>Загруженные видео появятся здесь</span>
            </div>
          )}
        </div>
        <div className="drawer-footer">
          {isMock && (
            <p className="mock-note">
              <span />
              Демонстрационные данные
            </p>
          )}
        </div>
      </aside>
    </>
  )
}
