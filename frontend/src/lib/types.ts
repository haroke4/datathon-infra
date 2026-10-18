export type Model = { id: string; name: string }
export type Status = 'processing' | 'done' | 'failed'
export type JobSummary = {
  job_id: string
  filename: string
  created_at: string
  model_id: string
  status: Status
  queue_position: number
}
export type SourceReference = { label: string; url: string }
export type Violation = {
  // Catalog code such as "A4"; optional, the jury format only requires type.
  code?: string
  type: string
  timecode_sec: number
  description: string
  evidence_frames: { timestamp_sec: number; image_base64: string }[]
  sources?: SourceReference[]
  source_note?: string
}
export type JobResult = {
  job_id: string
  status: Status
  queue_position?: number
  verdict?: 'violation' | 'no_violation'
  violations?: Violation[]
  error?: { code: string; message: string }
}
export type Annotation = {
  violation_index: number
  start_sec: number
  end_sec: number
  box: { x: number; y: number; width: number; height: number }
  rule: { title: string; section: string; url: string } | null
  rule_note: string
}
export type Annotations = { duration_sec: number; events: Annotation[] }

export type ReviewDecision =
  'pending' | 'confirmed' | 'insufficient_data' | 'rejected'
export type ViolationReview = {
  violation_index: number
  violation_key: string
  decision: ReviewDecision
  updated_at: string | null
}
export type ReviewsResponse = { job_id: string; reviews: ViolationReview[] }
export type ReviewCounts = Record<ReviewDecision, number>

export type AnalyticsPeriod = 'today' | 'week' | 'month'
export type Analytics = {
  period: AnalyticsPeriod
  timezone: string
  start: string
  end: string
  summary: {
    checks: number
    completed: number
    processing: number
    failed: number
    clean: number
    with_violations: number
    violations: number
    duration_sec: number
  }
  reviews: ReviewCounts
  comparison: { start: string; end: string; summary: Analytics['summary'] }
  hours: {
    hour: number
    checks: number
    completed: number
    with_violations: number
    violations: number
  }[]
  timeline: { start: string; checks: number; violations: number }[]
  categories: {
    key: string
    code: string | null
    title: string
    count: number
    checks: number
    reviews: ReviewCounts
  }[]
  recent: {
    job_id: string
    filename: string
    created_at: string
    violation_index: number
    category_key: string
    title: string
    timecode_sec: number
    decision: ReviewDecision
  }[]
}
