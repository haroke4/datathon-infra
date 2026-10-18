import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Film,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AnalyticsTools } from './analytics-tools'
import { ReviewStatistics } from './review-statistics'
import { REVIEW_DECISIONS } from '@/lib/review-notes'
import { api } from '@/lib/api'
import { formatTime } from '@/lib/format-time'
import type { Analytics, AnalyticsPeriod, ReviewDecision } from '@/lib/types'

const periods: { value: AnalyticsPeriod; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
]
const number = new Intl.NumberFormat('ru-RU')
const plurals = new Intl.PluralRules('ru-RU')
const word = (count: number, one: string, few: string, many: string) => {
  const form = plurals.select(count)
  return form === 'one' ? one : form === 'few' ? few : many
}
const colors = [
  '#d97757',
  '#578a78',
  '#7597b5',
  '#b39a69',
  '#9686a5',
  '#8a8a8a',
]
const date = (
  value: string,
  timezone: string,
  options: Intl.DateTimeFormatOptions
) => new Date(value).toLocaleString('ru-RU', { ...options, timeZone: timezone })
function duration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} сек`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60
    ? `${minutes} мин ${Math.floor(seconds % 60)} сек`
    : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
}

type Props = {
  onOpen: (event: Analytics['recent'][number]) => void
  onUpload: () => void
}

export function AnalyticsDashboard({ onOpen, onUpload }: Props) {
  const [period, setPeriod] = useState<AnalyticsPeriod>('today')
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [category, setCategory] = useState<string | null>(null)
  const [decisionFilter, setDecisionFilter] = useState<ReviewDecision | 'all'>(
    'all'
  )
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let inFlight = false
    setLoading(true)
    setError('')
    setData(null)
    const load = async () => {
      if (document.hidden || inFlight || controller.signal.aborted) return
      inFlight = true
      try {
        const result = await api.analytics(period, controller.signal)
        if (!controller.signal.aborted) {
          setData(result)
          setError('')
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError((cause as Error).message)
      } finally {
        inFlight = false
        if (!controller.signal.aborted) {
          setLoading(false)
          timer = setTimeout(load, 30000)
        }
      }
    }
    const resume = () => {
      clearTimeout(timer)
      void load()
    }
    void load()
    document.addEventListener('visibilitychange', resume)
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [period, attempt])

  const selectCategory = (key: string | null) => {
    setCategory(key)
    setPage(0)
  }
  const summary = data?.summary
  const filtered =
    data?.recent.filter(
      (item) =>
        (!category || item.category_key === category) &&
        (decisionFilter === 'all' ||
          (item.decision || 'pending') === decisionFilter) &&
        `${item.title} ${item.filename}`
          .toLocaleLowerCase('ru-RU')
          .includes(search.toLocaleLowerCase('ru-RU'))
    ) || []
  const pages = Math.max(1, Math.ceil(filtered.length / 8))
  const currentPage = Math.min(page, pages - 1)
  const max = Math.max(
    1,
    ...(data?.timeline.map((item) => item.violations) || [])
  )
  const top = data?.categories[0]
  const activeBucket = hovered === null ? null : data?.timeline[hovered]
  const title =
    period === 'today'
      ? 'Нарушения за сегодня'
      : period === 'week'
        ? 'Нарушения за неделю'
        : 'Нарушения за месяц'

  return (
    <div className="analytics-dashboard">
      <header className="analytics-header">
        <div>
          <div className="analytics-eyebrow">
            <BarChart3 size={15} /> Обзор кассовой дисциплины
          </div>
          <h1>Аналитика</h1>
          <p>Вся картина проверок — от общей динамики до каждого нарушения.</p>
        </div>
        <Button
          variant="outline"
          className="analytics-refresh"
          onClick={() => setAttempt((value) => value + 1)}
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />{' '}
          Обновить
        </Button>
      </header>

      <div className="analytics-toolbar">
        <div
          className="analytics-periods"
          role="group"
          aria-label="Период аналитики"
        >
          {periods.map((item) => (
            <button
              key={item.value}
              aria-pressed={period === item.value}
              onClick={() => {
                if (period === item.value) return
                setPeriod(item.value)
                setCategory(null)
                setDecisionFilter('all')
                setSearch('')
                setPage(0)
                setHovered(null)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="analytics-date-range">
          {data ? (
            <>
              {date(data.start, data.timezone, {
                day: 'numeric',
                month: 'long',
              })}
              {period !== 'today' && (
                <>
                  {' '}
                  —{' '}
                  {date(data.end, data.timezone, {
                    day: 'numeric',
                    month: 'long',
                  })}
                </>
              )}
            </>
          ) : (
            'Загружаем период…'
          )}
          {period !== 'today' && (
            <span>Последние {period === 'week' ? '7' : '30'} дней</span>
          )}
        </span>
      </div>

      {error && (
        <div className="analytics-error" role="alert">
          <TriangleAlert size={18} />
          <span>{error}</span>
          <Button
            variant="link"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Повторить
          </Button>
        </div>
      )}
      {loading && !data && (
        <div className="analytics-loading" role="status">
          <LoaderCircle size={24} className="animate-spin" />
          <span>Собираем статистику проверок…</span>
        </div>
      )}

      {data && summary && (
        <>
          <section
            className="analytics-metrics"
            aria-label="Основные показатели"
          >
            <article className="analytics-metric metric-accent">
              <span className="metric-label">
                <TriangleAlert size={16} /> Нарушений
              </span>
              <strong>{number.format(summary.violations)}</strong>
              <span>
                Проверок с нарушениями: {number.format(summary.with_violations)}
              </span>
            </article>
            <article className="analytics-metric">
              <span className="metric-label">
                <Film size={16} /> Проверок
              </span>
              <strong>{number.format(summary.checks)}</strong>
              <span>Завершено: {number.format(summary.completed)}</span>
            </article>
            <article className="analytics-metric">
              <span className="metric-label">
                <Clock3 size={16} /> Видео проанализировано
              </span>
              <strong className="metric-duration">
                {duration(summary.duration_sec)}
              </strong>
              <span>Суммарная длительность записей</span>
            </article>
            <article className="analytics-metric">
              <span className="metric-label">
                <ShieldCheck size={16} /> Без нарушений
              </span>
              <strong>
                {summary.completed
                  ? Math.round((summary.clean / summary.completed) * 100)
                  : 0}
                <small>%</small>
              </strong>
              <span>
                {number.format(summary.clean)} из{' '}
                {number.format(summary.completed)} завершённых проверок
              </span>
            </article>
          </section>

          <ReviewStatistics
            counts={data.reviews}
            selected={decisionFilter}
            onSelect={(value) => {
              setDecisionFilter(value)
              setPage(0)
              document
                .getElementById('analytics-events')
                ?.scrollIntoView({ behavior: 'instant', block: 'start' })
            }}
          />

          <div className="analytics-grid">
            <section
              className="analytics-panel analytics-trend"
              aria-labelledby="trend-title"
            >
              <div className="analytics-panel-heading">
                <div>
                  <h2 id="trend-title">Динамика нарушений</h2>
                  <p>
                    {period === 'today'
                      ? 'Распределение по часам'
                      : 'Распределение по дням'}
                  </p>
                </div>
                <span className="chart-legend">
                  <i /> Нарушения
                </span>
              </div>
              <div
                className="analytics-chart"
                onMouseLeave={() => setHovered(null)}
              >
                <div className="chart-y-axis" aria-hidden="true">
                  {[max, Math.floor(max / 2), 0].map((value, index) => (
                    <span key={index}>{value}</span>
                  ))}
                </div>
                <div className="chart-plot">
                  <div className="chart-grid" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="chart-bars">
                    {data.timeline.map((item, index) => {
                      const label = date(
                        item.start,
                        data.timezone,
                        period === 'today'
                          ? { hour: '2-digit', minute: '2-digit' }
                          : { day: 'numeric', month: 'short' }
                      )
                      return (
                        <div className="chart-column" key={item.start}>
                          <button
                            className={`chart-bar ${item.violations ? '' : 'is-zero'} ${hovered === index ? 'is-highlighted' : ''}`}
                            style={{
                              height: `${(item.violations / max) * 100}%`,
                            }}
                            onMouseEnter={() => setHovered(index)}
                            onFocus={() => setHovered(index)}
                            onBlur={() => setHovered(null)}
                            aria-label={`${label}: нарушений ${item.violations}, проверок ${item.checks}`}
                          >
                            <span className="sr-only">{item.violations}</span>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  <div className="chart-x-axis" aria-hidden="true">
                    {data.timeline.map((item, index) => (
                      <span key={item.start}>
                        {index %
                          (period === 'week'
                            ? 1
                            : period === 'month'
                              ? 5
                              : 4) ===
                        0
                          ? date(
                              item.start,
                              data.timezone,
                              period === 'today'
                                ? { hour: '2-digit' }
                                : { day: 'numeric', month: 'short' }
                            )
                          : ''}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="chart-caption" role="status">
                {activeBucket ? (
                  <>
                    <strong>
                      {date(activeBucket.start, data.timezone, {
                        day: 'numeric',
                        month: 'short',
                        ...(period === 'today'
                          ? { hour: '2-digit', minute: '2-digit' }
                          : {}),
                      })}
                    </strong>
                    <span>
                      Нарушений: {activeBucket.violations} · Проверок:{' '}
                      {activeBucket.checks}
                    </span>
                  </>
                ) : (
                  <>
                    <span>Всего за период</span>
                    <strong>
                      {number.format(summary.violations)} нарушений
                    </strong>
                  </>
                )}
              </div>
            </section>

            <section
              className="analytics-panel analytics-outcomes"
              aria-labelledby="outcomes-title"
            >
              <div className="analytics-panel-heading">
                <div>
                  <h2 id="outcomes-title">Результаты проверок</h2>
                  <p>Только завершённые записи</p>
                </div>
              </div>
              <div className="analytics-donut-wrap">
                <svg
                  className="analytics-donut"
                  viewBox="0 0 160 160"
                  role="img"
                  aria-label={`Проверок с нарушениями: ${summary.with_violations}, без нарушений: ${summary.clean}`}
                >
                  <circle
                    cx="80"
                    cy="80"
                    r="65"
                    fill="none"
                    stroke="#efefed"
                    strokeWidth="13"
                  />
                  {summary.completed > 0 && (
                    <>
                      <circle
                        cx="80"
                        cy="80"
                        r="65"
                        fill="none"
                        stroke="#578a78"
                        strokeWidth="13"
                        pathLength="100"
                      />
                      <circle
                        cx="80"
                        cy="80"
                        r="65"
                        fill="none"
                        stroke="#d97757"
                        strokeWidth="13"
                        pathLength="100"
                        strokeDasharray={`${(summary.with_violations / summary.completed) * 100} 100`}
                        transform="rotate(-90 80 80)"
                      />
                    </>
                  )}
                </svg>
                <div className="donut-center">
                  <strong>{summary.completed}</strong>
                  <span>завершено</span>
                </div>
              </div>
              <div className="outcome-legend">
                <span>
                  <i style={{ background: colors[0] }} /> С нарушениями{' '}
                  <strong>{summary.with_violations}</strong>
                </span>
                <span>
                  <i style={{ background: colors[1] }} /> Без нарушений{' '}
                  <strong>{summary.clean}</strong>
                </span>
              </div>
            </section>

            <section
              className="analytics-panel analytics-ranking"
              aria-labelledby="ranking-title"
            >
              <div className="analytics-panel-heading">
                <div>
                  <h2 id="ranking-title">Частые нарушения</h2>
                  <p>Сколько раз встречается каждый тип</p>
                </div>
                <span className="analytics-count">
                  Типов: {data.categories.length}
                </span>
              </div>
              {data.categories.length ? (
                <div className="ranking-list">
                  {data.categories.map((item, index) => (
                    <button
                      className={`ranking-row ${category === item.key ? 'is-selected' : ''}`}
                      key={item.key}
                      onClick={() =>
                        selectCategory(category === item.key ? null : item.key)
                      }
                      aria-pressed={category === item.key}
                    >
                      <span className="ranking-number">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="ranking-description">
                        <span>
                          {item.code && <b>{item.code}</b>}
                          {item.title}
                        </span>
                        <span className="ranking-track">
                          <span
                            style={{
                              width: `${(item.count / (top?.count || 1)) * 100}%`,
                              background: colors[index % colors.length],
                            }}
                          />
                        </span>
                        <small>
                          Проверок: {item.checks} ·{' '}
                          {Math.round((item.count / summary.violations) * 100)}%
                          нарушений
                        </small>
                      </span>
                      <strong>
                        {number.format(item.count)}
                        <small>{word(item.count, 'раз', 'раза', 'раз')}</small>
                      </strong>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="analytics-empty-small">
                  <ShieldCheck size={28} />
                  <p>Нарушений за период нет</p>
                  <span>Здесь появятся типы обнаруженных нарушений.</span>
                </div>
              )}
            </section>

            <section
              className="analytics-panel analytics-insight"
              aria-labelledby="insight-title"
            >
              <div className="analytics-panel-heading">
                <div>
                  <h2 id="insight-title">В фокусе</h2>
                  <p>Что происходит за выбранный период</p>
                </div>
              </div>
              {top ? (
                <>
                  <span className="insight-label">Самое частое нарушение</span>
                  <h3>{top.title}</h3>
                  <div className="insight-stat">
                    <strong>{top.count}</strong>
                    <span>
                      {word(top.count, 'случай', 'случая', 'случаев')} ·{' '}
                      {Math.round((top.count / summary.violations) * 100)}% от
                      всех нарушений
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      selectCategory(top.key)
                      document
                        .getElementById('analytics-events')
                        ?.scrollIntoView({
                          behavior: 'instant',
                          block: 'start',
                        })
                    }}
                  >
                    Посмотреть события <ArrowUpRight size={16} />
                  </Button>
                </>
              ) : (
                <div className="analytics-empty-small">
                  <Check size={28} />
                  <p>
                    {summary.completed
                      ? 'Все завершённые проверки без нарушений'
                      : 'Пока недостаточно данных'}
                  </p>
                  <span>
                    {summary.completed
                      ? 'Результаты новых проверок появятся автоматически.'
                      : 'Загрузите видео, чтобы начать собирать статистику.'}
                  </span>
                  {!summary.checks && (
                    <Button variant="outline" onClick={onUpload}>
                      Загрузить видео
                    </Button>
                  )}
                </div>
              )}
              <div className="analytics-status-line">
                <span>
                  В обработке <strong>{summary.processing}</strong>
                </span>
                <span>
                  Сбоев анализа <strong>{summary.failed}</strong>
                </span>
              </div>
            </section>
          </div>

          <AnalyticsTools key={`${data.period}-${data.start}`} data={data} />

          <section
            className="analytics-panel analytics-events"
            id="analytics-events"
            aria-labelledby="events-title"
          >
            <div className="analytics-panel-heading">
              <div>
                <h2 id="events-title">{title}</h2>
                <p>События из проверок за выбранный период</p>
              </div>
              <div className="analytics-event-filters">
                <select
                  aria-label="Фильтр по решению"
                  value={decisionFilter}
                  onChange={(event) => {
                    setDecisionFilter(
                      event.target.value as ReviewDecision | 'all'
                    )
                    setPage(0)
                  }}
                >
                  <option value="all">Все решения</option>
                  {Object.entries(REVIEW_DECISIONS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <label className="analytics-search">
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value)
                      setPage(0)
                    }}
                    placeholder="Найти нарушение или видео"
                    aria-label="Поиск по последним событиям"
                  />
                </label>
              </div>
            </div>
            {category && (
              <button
                className="analytics-filter"
                onClick={() => selectCategory(null)}
              >
                {data.categories.find((item) => item.key === category)?.title ||
                  category}
                <X size={14} />
                <span className="sr-only">Сбросить фильтр</span>
              </button>
            )}
            {filtered.length ? (
              <>
                <div className="analytics-table-wrap">
                  <table className="analytics-table">
                    <thead>
                      <tr>
                        <th>Нарушение</th>
                        <th>Видеозапись</th>
                        <th>Дата проверки</th>
                        <th>Таймкод</th>
                        <th>Решение</th>
                        <th>
                          <span className="sr-only">Открыть</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered
                        .slice(currentPage * 8, currentPage * 8 + 8)
                        .map((item) => (
                          <tr key={`${item.job_id}-${item.violation_index}`}>
                            <td>
                              <span className="event-dot" />
                              {item.title}
                            </td>
                            <td title={item.filename}>{item.filename}</td>
                            <td>
                              {date(item.created_at, data.timezone, {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td>
                              <button
                                className="event-timecode"
                                onClick={() => onOpen(item)}
                                aria-label={`Открыть ${item.filename}, ${formatTime(item.timecode_sec)}`}
                              >
                                {formatTime(item.timecode_sec)}
                              </button>
                            </td>
                            <td>
                              <span
                                className={`review-badge review-${item.decision || 'pending'}`}
                              >
                                {REVIEW_DECISIONS[item.decision || 'pending']}
                              </span>
                            </td>
                            <td>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => onOpen(item)}
                                aria-label={`Открыть нарушение: ${item.title}`}
                              >
                                <ArrowUpRight size={16} />
                              </Button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <div className="analytics-pagination">
                  <span>
                    {currentPage * 8 + 1}–
                    {Math.min((currentPage + 1) * 8, filtered.length)} из{' '}
                    {filtered.length} событий
                  </span>
                  <div>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={currentPage === 0}
                      onClick={() => setPage(currentPage - 1)}
                      aria-label="Предыдущая страница"
                    >
                      <ChevronLeft size={17} />
                    </Button>
                    <span>
                      {currentPage + 1} / {pages}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={currentPage >= pages - 1}
                      onClick={() => setPage(currentPage + 1)}
                      aria-label="Следующая страница"
                    >
                      <ChevronRight size={17} />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="analytics-empty-small">
                {search || category || decisionFilter !== 'all' ? (
                  <Search size={26} />
                ) : (
                  <ShieldCheck size={28} />
                )}
                <p>
                  {search || category || decisionFilter !== 'all'
                    ? 'По вашему запросу ничего не найдено'
                    : 'Нарушений за этот период нет'}
                </p>
                <span>
                  {search || category || decisionFilter !== 'all'
                    ? 'Измените поиск или выберите другой тип нарушения.'
                    : 'Выберите другой период или дождитесь новых проверок.'}
                </span>
              </div>
            )}
            {summary.violations > data.recent.length && (
              <p className="analytics-table-note">
                В списке последние {data.recent.length} событий. Поиск и фильтр
                применяются к этому списку; показатели и графики учитывают все{' '}
                {summary.violations} нарушений.
              </p>
            )}
          </section>
          <footer className="analytics-footnote">
            <span>
              Обновлено в{' '}
              {date(data.end, data.timezone, {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span>По дате загрузки видео · {data.timezone}</span>
          </footer>
          <p className="analytics-method-note">
            Нарушения — возможные признаки, найденные моделью. Время в графике
            соответствует загрузке записи, таймкод — моменту внутри видео.
          </p>
        </>
      )}
    </div>
  )
}
