import { readPreference, writePreference } from './preferences'
import type { ReviewDecision, Violation } from './types'
export type { ReviewDecision } from './types'

export const REVIEW_DECISIONS = {
  pending: 'Не проверено',
  confirmed: 'Подтверждено',
  insufficient_data: 'Недостаточно данных',
  rejected: 'Отклонено',
} as const
export type ReviewNote = { decision: ReviewDecision; comment: string }
export type ReviewNotes = Record<string, ReviewNote>
export const EMPTY_REVIEW_NOTE: ReviewNote = {
  decision: 'pending',
  comment: '',
}

// Include event identity so notes cannot move to a different event after a result changes.
export function reviewNoteKey(violation: Violation, index: number) {
  return JSON.stringify([
    index,
    violation.code || '',
    violation.type,
    violation.timecode_sec,
  ])
}

export function readReviewNotes(jobId: string): ReviewNotes {
  try {
    const saved: unknown = JSON.parse(
      readPreference(`forte.review-notes.${jobId}`) || '{}'
    )
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
    return Object.fromEntries(
      Object.entries(saved)
        .map(([key, note]) => [
          key,
          note && typeof note === 'object'
            ? {
                ...note,
                decision:
                  note.decision === 'dismissed'
                    ? 'rejected'
                    : note.decision === 'clarification'
                      ? 'insufficient_data'
                      : note.decision,
              }
            : note,
        ])
        .filter(
          ([, note]) =>
            note &&
            typeof note === 'object' &&
            typeof note.decision === 'string' &&
            Object.hasOwn(REVIEW_DECISIONS, note.decision) &&
            typeof note.comment === 'string'
        )
    )
  } catch {
    return {}
  }
}

export function saveReviewNotes(jobId: string, notes: ReviewNotes) {
  writePreference(`forte.review-notes.${jobId}`, JSON.stringify(notes))
}
