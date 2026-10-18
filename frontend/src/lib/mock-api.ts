import type {
  Analytics,
  AnalyticsPeriod,
  Annotations,
  JobResult,
  JobSummary,
  Model,
  ReviewCounts,
  ReviewDecision,
  Violation,
  ViolationReview,
} from './types'

// In-memory mock transport. No video or frame leaves the browser.
type Record = JobSummary & {
  readyAt: number
  duration: number
  videoUrl?: string
  clean: boolean
}
export const models: Model[] = [
  { id: 'local-default', name: 'Локальная модель' },
  { id: 'demo-violations', name: 'Демо: с нарушениями' },
  { id: 'demo-clean', name: 'Демо: без нарушений' },
]
const now = Date.now()
const records: Record[] = [
  {
    job_id: 'demo-01',
    filename: 'cash_desk_01.mov',
    created_at: new Date(now - 3600000).toISOString(),
    model_id: 'local-default',
    status: 'done',
    queue_position: 0,
    readyAt: 0,
    duration: 65,
    clean: false,
  },
  {
    job_id: 'demo-02',
    filename: 'cash_desk_02.mov',
    created_at: new Date(now - 7200000).toISOString(),
    model_id: 'demo-clean',
    status: 'done',
    queue_position: 0,
    readyAt: 0,
    duration: 65,
    clean: true,
  },
  {
    job_id: 'demo-03',
    filename: 'cash_desk_03.mov',
    created_at: new Date(now - 86400000).toISOString(),
    model_id: 'local-default',
    status: 'done',
    queue_position: 0,
    readyAt: 0,
    duration: 65,
    clean: false,
  },
  {
    job_id: 'demo-04',
    filename: 'cash_desk_04.mov',
    created_at: new Date(now - 90000000).toISOString(),
    model_id: 'demo-clean',
    status: 'done',
    queue_position: 0,
    readyAt: 0,
    duration: 65,
    clean: true,
  },
]
for (const [index, days] of [3, 5, 8, 12, 18, 25].entries()) {
  records.push({
    job_id: `demo-archive-${index}`,
    filename: `cash_desk_archive_${index + 1}.mov`,
    created_at: new Date(now - days * 86400000).toISOString(),
    model_id: 'local-default',
    status: 'done',
    queue_position: 0,
    readyAt: 0,
    duration: 65,
    clean: index % 3 === 0,
  })
}
function refresh() {
  const pending = records
    .filter((r) => r.readyAt > Date.now())
    .sort((a, b) => a.readyAt - b.readyAt)
  records.forEach((r) => {
    r.status = r.readyAt > Date.now() ? 'processing' : 'done'
    r.queue_position = Math.max(0, pending.indexOf(r))
  })
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const error = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status)

function getDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const finish = (duration: number) => {
      clearTimeout(timer)
      video.onloadedmetadata = null
      video.onerror = null
      video.removeAttribute('src')
      video.load()
      resolve(duration)
    }
    const timer = setTimeout(() => finish(65), 2500)
    video.preload = 'metadata'
    video.onloadedmetadata = () =>
      finish(
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : 65
      )
    video.onerror = () => finish(65)
    video.src = url
  })
}

const emptyReviewCounts = (): ReviewCounts => ({
  pending: 0,
  confirmed: 0,
  insufficient_data: 0,
  rejected: 0,
})
const reviewDecisions: ReviewDecision[] = [
  'pending',
  'confirmed',
  'insufficient_data',
  'rejected',
]
const reviewMemory = new Map<string, ViolationReview[]>()
function readMockReviews(jobId: string): ViolationReview[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(`forte.demo-reviews.${jobId}`) || 'null'
    )
    if (Array.isArray(saved))
      return saved.filter(
        (item) =>
          item &&
          typeof item.violation_key === 'string' &&
          Number.isInteger(item.violation_index) &&
          reviewDecisions.includes(item.decision)
      )
  } catch {
    /* Tests or private browsing may not expose storage. */
  }
  return reviewMemory.get(jobId) || []
}
async function mockViolationKey(violation: Violation) {
  const data = new TextEncoder().encode(
    JSON.stringify([
      violation.code || '',
      violation.type,
      violation.timecode_sec,
    ])
  )
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('')
}

export async function mockFetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  options?.signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const signal = options?.signal
    const abort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, 120)
    signal?.addEventListener('abort', abort, { once: true })
  })
  options?.signal?.throwIfAborted()
  refresh()
  if (path === '/models') return json({ models })
  const reviewRoute = path.match(
    /^\/jobs\/([^/]+)\/(reviews|violations\/(\d+)\/review)$/
  )
  if (reviewRoute) {
    const jobId = decodeURIComponent(reviewRoute[1])
    const response = await mockFetch(
      `/jobs/${jobId}`,
      options?.signal ? { signal: options.signal } : undefined
    )
    if (!response.ok) return response
    const job = (await response.json()) as JobResult
    if (job.status !== 'done')
      return error(
        409,
        'JOB_NOT_READY',
        'Решения доступны после завершения анализа.'
      )
    const saved = readMockReviews(jobId)
    const reviews: ViolationReview[] = await Promise.all(
      (job.violations || []).map(async (violation, index) => {
        const key = await mockViolationKey(violation)
        return (
          saved.find(
            (item) =>
              item.violation_index === index && item.violation_key === key
          ) || {
            violation_index: index,
            violation_key: key,
            decision: 'pending',
            updated_at: null,
          }
        )
      })
    )
    options?.signal?.throwIfAborted()
    if (reviewRoute[2] === 'reviews') return json({ job_id: jobId, reviews })
    if (options?.method !== 'PUT')
      return error(405, 'METHOD_NOT_ALLOWED', 'Метод не поддерживается.')
    const index = Number(reviewRoute[3])
    if (!reviews[index])
      return error(404, 'VIOLATION_NOT_FOUND', 'Нарушение не найдено.')
    let body: { decision?: ReviewDecision; violation_key?: string }
    try {
      body = JSON.parse(String(options.body))
    } catch {
      return error(422, 'VALIDATION_ERROR', 'Некорректное решение.')
    }
    if (!body || !reviewDecisions.includes(body.decision!))
      return error(422, 'VALIDATION_ERROR', 'Некорректное решение.')
    if (body.violation_key !== reviews[index].violation_key)
      return error(
        409,
        'RESULT_CHANGED',
        'Результат изменился. Откройте проверку заново.'
      )
    const result = {
      ...reviews[index],
      decision: body.decision!,
      updated_at: new Date().toISOString(),
    }
    reviews[index] = result
    reviewMemory.set(jobId, reviews)
    try {
      localStorage.setItem(
        `forte.demo-reviews.${jobId}`,
        JSON.stringify(reviews)
      )
    } catch {
      /* In-memory demo still works. */
    }
    return json(result)
  }
  if (path.startsWith('/analytics?')) {
    const params = new URLSearchParams(path.split('?')[1])
    const period = (params.get('period') || 'today') as AnalyticsPeriod
    const end = new Date()
    const start = new Date(end)
    start.setHours(0, 0, 0, 0)
    const days = { today: 1, week: 7, month: 30 }[period]
    if (!days) return error(422, 'INVALID_PERIOD', 'Неизвестный период.')
    start.setDate(start.getDate() - days + 1)
    const previousStart = new Date(start)
    previousStart.setDate(previousStart.getDate() - days)
    const previousEnd = new Date(end)
    previousEnd.setDate(previousEnd.getDate() - days)
    const timeline: Analytics['timeline'] = []
    const stop = new Date(end)
    stop.setHours(24, 0, 0, 0)
    const cursor = new Date(start)
    while (cursor < stop) {
      timeline.push({ start: cursor.toISOString(), checks: 0, violations: 0 })
      if (period === 'today') cursor.setTime(cursor.getTime() + 3600000)
      else cursor.setDate(cursor.getDate() + 1)
    }
    const emptySummary = {
      checks: 0,
      completed: 0,
      processing: 0,
      failed: 0,
      clean: 0,
      with_violations: 0,
      violations: 0,
      duration_sec: 0,
    }
    const data: Analytics = {
      period,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      start: start.toISOString(),
      end: end.toISOString(),
      summary: { ...emptySummary },
      reviews: emptyReviewCounts(),
      comparison: {
        start: previousStart.toISOString(),
        end: previousEnd.toISOString(),
        summary: { ...emptySummary },
      },
      hours: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        checks: 0,
        completed: 0,
        with_violations: 0,
        violations: 0,
      })),
      timeline,
      categories: [],
      recent: [],
    }
    for (const record of records) {
      const created = new Date(record.created_at)
      const isPrevious = created >= previousStart && created <= previousEnd
      if (!isPrevious && (created < start || created > end)) continue
      const summary = isPrevious ? data.comparison.summary : data.summary
      const bucket = isPrevious
        ? null
        : [...timeline]
            .reverse()
            .find((item) => new Date(item.start) <= created)!
      summary.checks++
      if (bucket) bucket.checks++
      const hour = isPrevious ? null : data.hours[created.getHours()]
      if (hour) hour.checks++
      if (record.status !== 'done') {
        summary.processing++
        continue
      }
      const result = await mockFetch(`/jobs/${record.job_id}`, options)
      const job = (await result.json()) as JobResult
      summary.completed++
      summary.duration_sec += record.duration
      const violations = job.violations || []
      summary[violations.length ? 'with_violations' : 'clean']++
      summary.violations += violations.length
      if (isPrevious) continue
      bucket!.violations += violations.length
      hour!.completed++
      hour!.violations += violations.length
      if (violations.length) hour!.with_violations++
      const seen = new Set<string>()
      const savedReviews = readMockReviews(record.job_id)
      const keys = await Promise.all(violations.map(mockViolationKey))
      violations.forEach((violation, index) => {
        const decision =
          savedReviews.find(
            (item) =>
              item.violation_index === index &&
              item.violation_key === keys[index]
          )?.decision || 'pending'
        data.reviews[decision]++
        const key = violation.code || violation.type.toLowerCase()
        let category = data.categories.find((item) => item.key === key)
        if (!category) {
          category = {
            key,
            code: violation.code || null,
            title: violation.type,
            count: 0,
            checks: 0,
            reviews: emptyReviewCounts(),
          }
          data.categories.push(category)
        }
        category.count++
        category.reviews[decision]++
        if (!seen.has(key)) category.checks++
        seen.add(key)
        data.recent.push({
          job_id: record.job_id,
          filename: record.filename,
          created_at: record.created_at,
          violation_index: index,
          category_key: key,
          title: violation.type,
          timecode_sec: violation.timecode_sec,
          decision,
        })
      })
    }
    data.categories.sort(
      (a, b) => b.count - a.count || a.title.localeCompare(b.title)
    )
    data.recent.sort((a, b) => b.created_at.localeCompare(a.created_at))
    data.recent = data.recent.slice(0, 100)
    return json(data)
  }
  if (path === '/jobs')
    return json({
      jobs: records.map(
        ({
          job_id,
          filename,
          created_at,
          model_id,
          status,
          queue_position,
        }) => ({
          job_id,
          filename,
          created_at,
          model_id,
          status,
          queue_position,
        })
      ),
    })
  if (path === '/analyze' && options?.method === 'POST') {
    const form = options.body as FormData
    const file = form.get('file')
    const modelId = String(form.get('model_id') || 'local-default')
    if (!(file instanceof File))
      return error(400, 'FILE_REQUIRED', 'Выберите видеофайл.')
    if (!/\.(mov|mp4|webm)$/i.test(file.name))
      return error(415, 'UNSUPPORTED_FORMAT', 'Поддерживаются MOV, MP4 и WebM.')
    if (file.size === 0)
      return error(400, 'EMPTY_FILE', 'Файл пуст. Выберите другое видео.')
    if (file.size > 100 * 1024 * 1024)
      return error(413, 'FILE_TOO_LARGE', 'Максимальный размер файла — 100 МБ.')
    if (!models.some((m) => m.id === modelId))
      return error(400, 'UNKNOWN_MODEL', 'Выберите доступную модель.')
    const videoUrl = URL.createObjectURL(file)
    const duration = await getDuration(videoUrl)
    if (options?.signal?.aborted) {
      URL.revokeObjectURL(videoUrl)
      options.signal.throwIfAborted()
    }
    refresh()
    const active = records.filter((r) => r.status === 'processing')
    const readyAt =
      Math.max(Date.now(), ...active.map((r) => r.readyAt)) + 18000
    const job_id = crypto.randomUUID()
    records.unshift({
      job_id,
      filename: file.name,
      created_at: new Date().toISOString(),
      model_id: modelId,
      status: 'processing',
      queue_position: active.length,
      readyAt,
      duration,
      videoUrl,
      clean: modelId === 'demo-clean',
    })
    return json({ job_id }, 202)
  }
  const match = path.match(/^\/jobs\/([^/]+)(\/annotations|\/video)?$/)
  const record = records.find((r) => r.job_id === match?.[1])
  if (!record) return error(404, 'JOB_NOT_FOUND', 'Проверка не найдена.')
  if (match?.[2] === '/video') {
    if (!record.videoUrl)
      return error(
        404,
        'DEMO_VIDEO',
        'У демонстрационной проверки нет исходного видео.'
      )
    return fetch(record.videoUrl)
  }
  const first = Math.min(32, record.duration * 0.5)
  const second = Math.min(48, record.duration * 0.75)
  if (match?.[2] === '/annotations') {
    if (record.status !== 'done')
      return error(409, 'JOB_NOT_READY', 'Анализ ещё не завершён.')
    const annotations: Annotations = {
      duration_sec: record.duration,
      events: record.clean
        ? []
        : [first, second].map((time, index) => ({
            violation_index: index,
            start_sec: time,
            end_sec: Math.min(record.duration, time + 4),
            box:
              index === 0
                ? { x: 0.12, y: 0.24, width: 0.19, height: 0.36 }
                : { x: 0.52, y: 0.3, width: 0.17, height: 0.28 },
            rule: null,
            rule_note:
              'Демо: нормативный источник не подключён. Требуется проверка специалистом.',
          })),
    }
    return json(annotations)
  }
  const result: JobResult = {
    job_id: record.job_id,
    status: record.status,
    queue_position: record.queue_position,
  }
  if (record.status === 'done') {
    result.verdict = record.clean ? 'no_violation' : 'violation'
    result.violations = record.clean
      ? []
      : [
          {
            code: 'B1',
            type: 'Деньги оставлены на рабочей поверхности',
            timecode_sec: first,
            description:
              'На столе остаются купюры после завершения обслуживания клиента. Возможный признак нарушения кассовой дисциплины; требуется проверка.',
            evidence_frames: [],
          },
          {
            code: 'A4',
            type: 'Рабочая зона оставлена без присмотра',
            timecode_sec: second,
            description:
              'Кассир покидает рабочую зону, на поверхности остаются ценности. Возможный признак нарушения; требуется проверка.',
            evidence_frames: [],
          },
        ]
  }
  return json(result)
}
