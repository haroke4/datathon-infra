import type {
  Analytics,
  AnalyticsPeriod,
  Annotations,
  JobResult,
  JobSummary,
  Model,
  ReviewDecision,
  ReviewsResponse,
  ViolationReview,
} from './types'
import { mockFetch } from './mock-api'

// Production must always talk to the backend. Demos are an explicit local opt-in.
export const isMock =
  import.meta.env.DEV && import.meta.env.VITE_USE_MOCK_API === 'true'
const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api/ui').replace(
  /\/$/,
  ''
)
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const timeout = AbortSignal.timeout(
    options.method === 'POST' ? 120000 : 20000
  )
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout
  try {
    const response = await (isMock
      ? mockFetch(path, { ...options, signal })
      : fetch(`${baseUrl}${path}`, {
          credentials: 'include',
          ...options,
          signal,
        }))
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(
        data?.error?.message ||
          `Ошибка запроса (${response.status}). Попробуйте ещё раз.`
      )
    }
    return (await response.json()) as T
  } catch (error) {
    if (timeout.aborted)
      throw new Error(
        'Сервер не отвечает. Проверьте подключение и попробуйте ещё раз.'
      )
    if (!signal.aborted && error instanceof TypeError)
      throw new Error(
        'Не удалось подключиться к серверу. Проверьте соединение и повторите попытку.'
      )
    if (error instanceof SyntaxError)
      throw new Error('Сервер вернул некорректный ответ. Попробуйте ещё раз.')
    throw error
  }
}
// Reopening a completed check reuses its video rather than copying a large Blob again.
const videoUrls = new Map<string, Promise<string | null>>()
export const api = {
  analytics: (period: AnalyticsPeriod, signal?: AbortSignal) => {
    const query = new URLSearchParams({
      period,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    return request<Analytics>(`/analytics?${query}`, { signal })
  },
  models: (signal?: AbortSignal) =>
    request<{ models: Model[] }>('/models', { signal }),
  history: (signal?: AbortSignal) =>
    request<{ jobs: JobSummary[] }>('/jobs', { signal }),
  analyze: (file: File, modelId: string) => {
    const body = new FormData()
    body.set('file', file)
    body.set('model_id', modelId)
    return request<{ job_id: string }>('/analyze', { method: 'POST', body })
  },
  job: (id: string, signal?: AbortSignal) =>
    request<JobResult>(`/jobs/${encodeURIComponent(id)}`, { signal }),
  reviews: (id: string, signal?: AbortSignal) =>
    request<ReviewsResponse>(`/jobs/${encodeURIComponent(id)}/reviews`, {
      signal,
    }),
  reviewDecision: (
    id: string,
    review: ViolationReview,
    decision: ReviewDecision,
    signal?: AbortSignal
  ) =>
    request<ViolationReview>(
      `/jobs/${encodeURIComponent(id)}/violations/${review.violation_index}/review`,
      {
        method: 'PUT',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, violation_key: review.violation_key }),
      }
    ),
  annotations: (id: string, signal?: AbortSignal) =>
    request<Annotations>(`/jobs/${encodeURIComponent(id)}/annotations`, {
      signal,
    }),
  video: (id: string): Promise<string | null> => {
    const path = `/jobs/${encodeURIComponent(id)}/video`
    if (!isMock) return Promise.resolve(`${baseUrl}${path}`)
    if (!videoUrls.has(id)) {
      const load = mockFetch(path)
        .then(async (response) =>
          response.ok ? URL.createObjectURL(await response.blob()) : null
        )
        .catch((error) => {
          videoUrls.delete(id)
          throw error
        })
      videoUrls.set(id, load)
    }
    return videoUrls.get(id)!
  },
}
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    for (const promise of videoUrls.values())
      void promise
        .then((url) => {
          if (url) URL.revokeObjectURL(url)
        })
        .catch(() => {})
    videoUrls.clear()
  })
