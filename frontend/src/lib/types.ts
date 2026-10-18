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
export type Violation = {
  // Catalog code such as "A4"; optional, the jury format only requires type.
  code?: string
  type: string
  timecode_sec: number
  description: string
  evidence_frames: { timestamp_sec: number; image_base64: string }[]
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
