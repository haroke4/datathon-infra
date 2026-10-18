import { useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  Download,
  Minus,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { analyticsCsv, comparisonChange } from '@/lib/analytics-report'
import type { Analytics } from '@/lib/types'

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const hourLabel = (hour: number) =>
  `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`
const rangeDate = (value: string, timezone: string) =>
  new Date(value).toLocaleString('ru-RU', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

function Change({
  current,
  previous,
  points = false,
}: {
  current: number
  previous: number
  points?: boolean
}) {
  const { difference, percent } = comparisonChange(current, previous)
  const Arrow =
    difference > 0 ? ArrowUpRight : difference < 0 ? ArrowDownRight : Minus
  return (
    <span className="comparison-change">
      <Arrow size={14} />
      {difference === 0
        ? 'Без изменений'
        : points
          ? `${difference > 0 ? '+' : ''}${number.format(difference)} п.п.`
          : percent === null
            ? `+${number.format(difference)} · ранее 0`
            : `${difference > 0 ? '+' : ''}${number.format(percent)}%`}
    </span>
  )
}

export function AnalyticsTools({ data }: { data: Analytics }) {
  const [metric, setMetric] = useState<'violations' | 'checks'>('violations')
  const [selectedHour, setSelectedHour] = useState<number | null>(null)
  const [exportError, setExportError] = useState('')
  const [downloaded, setDownloaded] = useState(false)
  // A frontend upgrade can arrive before the optional analytics backend upgrade.
  if (!data.comparison || !data.hours?.length) return null
  const previous = data.comparison.summary
  const current = data.summary
  const peak = data.hours.reduce((best, item) =>
    item[metric] > best[metric] ? item : best
  )
  const selected =
    selectedHour === null
      ? peak
      : data.hours.find((item) => item.hour === selectedHour) || peak
  const max = Math.max(1, peak[metric])
  const currentRate = current.completed
    ? (current.with_violations / current.completed) * 100
    : null
  const previousRate = previous.completed
    ? (previous.with_violations / previous.completed) * 100
    : null

  const download = () => {
    let url: string | null = null
    let link: HTMLAnchorElement | null = null
    try {
      setExportError('')
      url = URL.createObjectURL(
        new Blob([analyticsCsv(data)], { type: 'text/csv;charset=utf-8;' })
      )
      link = document.createElement('a')
      link.href = url
      link.download = `analytics-${data.period}-${data.end.slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      setDownloaded(true)
    } catch {
      setExportError('Не удалось подготовить отчёт. Попробуйте ещё раз.')
    } finally {
      link?.remove()
      if (url) {
        const downloadUrl = url
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      }
    }
  }

  return (
    <section className="analytics-tools" aria-labelledby="tools-title">
      <div className="analytics-tools-heading">
        <div>
          <h2 id="tools-title">Инструменты</h2>
          <p>Сравните периоды, найдите пиковые часы и сохраните отчёт.</p>
        </div>
        <Button
          variant="outline"
          className="analytics-export"
          onClick={download}
        >
          <Download size={15} />
          Экспорт CSV
        </Button>
      </div>
      {(downloaded || exportError) && (
        <p
          className={`analytics-export-message ${exportError ? 'is-error' : ''}`}
          role={exportError ? 'alert' : 'status'}
        >
          {exportError ||
            'Отчёт подготовлен. Все показатели выгружены полностью; список событий — последние 100 нарушений.'}
        </p>
      )}
      <div className="analytics-tools-grid">
        <article className="analytics-panel analytics-comparison">
          <div className="analytics-panel-heading">
            <div>
              <h2>
                <TrendingUp size={16} /> Сравнение с прошлым периодом
              </h2>
              <p>
                {rangeDate(data.comparison.start, data.timezone)} —{' '}
                {rangeDate(data.comparison.end, data.timezone)}
              </p>
            </div>
          </div>
          <div className="comparison-row">
            <span>
              Нарушений<small>Ранее: {previous.violations}</small>
            </span>
            <strong>{current.violations}</strong>
            <Change
              current={current.violations}
              previous={previous.violations}
            />
          </div>
          <div className="comparison-row">
            <span>
              Завершённых проверок<small>Ранее: {previous.completed}</small>
            </span>
            <strong>{current.completed}</strong>
            <Change current={current.completed} previous={previous.completed} />
          </div>
          <div className="comparison-row">
            <span>
              Проверок с нарушениями
              <small>
                Ранее:{' '}
                {previousRate === null
                  ? 'нет данных'
                  : `${number.format(previousRate)}%`}
              </small>
            </span>
            <strong>
              {currentRate === null ? '—' : `${number.format(currentRate)}%`}
            </strong>
            {currentRate !== null && previousRate !== null ? (
              <Change current={currentRate} previous={previousRate} points />
            ) : (
              <span className="comparison-change">Нет базы для сравнения</span>
            )}
          </div>
          <p className="analytics-tool-note">
            Сравнение до того же местного времени. Доля считается по завершённым
            проверкам, чтобы учитывать разное количество видео.
          </p>
        </article>
        <article className="analytics-panel analytics-hours">
          <div className="analytics-panel-heading">
            <div>
              <h2>
                <Clock3 size={16} /> Пиковые часы
              </h2>
              <p>По времени загрузки записей, за весь выбранный период</p>
            </div>
          </div>
          <div
            className="hour-metric-switch"
            role="group"
            aria-label="Показатель пиковых часов"
          >
            <button
              aria-pressed={metric === 'violations'}
              onClick={() => {
                setMetric('violations')
                setSelectedHour(null)
              }}
            >
              Нарушения
            </button>
            <button
              aria-pressed={metric === 'checks'}
              onClick={() => {
                setMetric('checks')
                setSelectedHour(null)
              }}
            >
              Проверки
            </button>
          </div>
          <div className="hour-grid">
            {data.hours.map((item) => (
              <button
                key={item.hour}
                className="hour-cell"
                aria-pressed={selected.hour === item.hour}
                onClick={() => setSelectedHour(item.hour)}
                style={{
                  background: `rgba(217, 119, 87, ${item[metric] ? 0.1 + (item[metric] / max) * 0.35 : 0.035})`,
                }}
                aria-label={`${hourLabel(item.hour)}: нарушений ${item.violations}, проверок ${item.checks}`}
              >
                <span>{String(item.hour).padStart(2, '0')}</span>
                <strong>{item[metric]}</strong>
              </button>
            ))}
          </div>
          <div className="hour-detail">
            <strong>{hourLabel(selected.hour)}</strong>
            <span>
              Проверок: {selected.checks} · Нарушений: {selected.violations}
            </span>
          </div>
          <p className="analytics-tool-note">
            Выберите час, чтобы увидеть детали. Эти данные показывают время
            загрузки видео; время съёмки неизвестно.
          </p>
        </article>
      </div>
      <p className="analytics-tool-note export-scope">
        CSV содержит оба периода, сводку, все типы нарушений, динамику, часы
        загрузки и до 100 последних событий. Поиск и фильтр таблицы не влияют на
        выгрузку.
      </p>
    </section>
  )
}
