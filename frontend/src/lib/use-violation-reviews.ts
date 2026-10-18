import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { ReviewDecision, ViolationReview } from './types'

export function useViolationReviews(jobId: string, count: number) {
  const [reviews, setReviews] = useState<ViolationReview[]>([])
  const [loading, setLoading] = useState(count > 0)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [pending, setPending] = useState<Set<number>>(new Set())
  const [errors, setErrors] = useState<Record<number, string>>({})
  const controller = useRef<AbortController | null>(null)
  const busy = useRef(new Set<number>())

  useEffect(() => {
    const request = new AbortController()
    controller.current = request
    busy.current = new Set()
    setPending(new Set())
    setErrors({})
    setReviews([])
    setError('')
    setLoading(count > 0)
    if (count > 0)
      void api
        .reviews(jobId, request.signal)
        .then((result) => {
          if (!request.signal.aborted) setReviews(result.reviews)
        })
        .catch((cause) => {
          if (!request.signal.aborted) setError((cause as Error).message)
        })
        .finally(() => {
          if (!request.signal.aborted) setLoading(false)
        })
    return () => request.abort()
  }, [jobId, count, attempt])

  const save = async (index: number, decision: ReviewDecision) => {
    const review = reviews.find((item) => item.violation_index === index)
    const request = controller.current
    if (
      !review ||
      !request ||
      request.signal.aborted ||
      busy.current.has(index)
    )
      return
    if (review.decision === decision && !errors[index]) return
    busy.current.add(index)
    setPending(new Set(busy.current))
    setErrors((previous) => ({ ...previous, [index]: '' }))
    try {
      const saved = await api.reviewDecision(
        jobId,
        review,
        decision,
        request.signal
      )
      if (!request.signal.aborted)
        setReviews((previous) =>
          previous.map((item) =>
            item.violation_index === index ? saved : item
          )
        )
    } catch (cause) {
      if (!request.signal.aborted)
        setErrors((previous) => ({
          ...previous,
          [index]: (cause as Error).message,
        }))
    } finally {
      if (!request.signal.aborted) {
        busy.current.delete(index)
        setPending(new Set(busy.current))
      }
    }
  }
  return {
    reviews,
    loading,
    error,
    pending,
    errors,
    save,
    retry: () => setAttempt((value) => value + 1),
  }
}
