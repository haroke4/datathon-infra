import type { Annotations, JobResult, JobSummary, Model } from './types'

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
