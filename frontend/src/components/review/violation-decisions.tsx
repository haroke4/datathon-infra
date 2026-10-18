import { Check, HelpCircle, LoaderCircle, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ReviewDecision, ViolationReview } from '@/lib/types'
import { REVIEW_DECISIONS } from '@/lib/review-notes'

const choices = [
  { value: 'confirmed', label: 'Подтверждаю', Icon: Check },
  {
    value: 'insufficient_data',
    label: 'Недостаточно данных',
    Icon: HelpCircle,
  },
  { value: 'rejected', label: 'Отклоняю', Icon: X },
] as const

type Props = {
  index: number
  review?: ViolationReview
  loading: boolean
  saving: boolean
  error: string
  loadError: string
  onSave: (decision: ReviewDecision) => void
  onRetry: () => void
  children?: ReactNode
}

export function ViolationDecisions({
  index,
  review,
  loading,
  saving,
  error,
  loadError,
  onSave,
  onRetry,
  children,
}: Props) {
  const disabled = loading || saving || !review
  return (
    <div className="violation-decisions">
      <div className="decision-heading">
        <span>Решение проверяющего</span>
        {saving && <LoaderCircle size={13} className="animate-spin" />}
      </div>
      <div
        className="decision-buttons"
        role="group"
        aria-label={`Решение по нарушению ${index + 1}`}
        aria-busy={saving}
      >
        {choices.map(({ value, label, Icon }) => (
          <button
            key={value}
            className={`decision-button decision-${value}`}
            aria-pressed={review?.decision === value}
            disabled={disabled}
            onClick={() => onSave(value)}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>
      {loadError ? (
        <div className="decision-error" role="alert">
          <span>{loadError}</span>
          <button onClick={onRetry}>Загрузить решения ещё раз</button>
        </div>
      ) : loading || saving || !review || review.decision !== 'pending' ? (
        <p className="decision-state" role="status">
          {loading ? (
            'Загружаем решение…'
          ) : saving ? (
            'Сохраняем на сервере…'
          ) : review ? (
            <>
              {REVIEW_DECISIONS[review.decision]}
              {review.updated_at && ' · сохранено на сервере'}
            </>
          ) : (
            'Решение недоступно'
          )}
        </p>
      ) : null}
      {error && (
        <p className="decision-error" role="alert">
          {error} Выберите решение ещё раз, чтобы повторить сохранение.
        </p>
      )}
      {review && review.decision !== 'pending' && (
        <button
          className="decision-reset"
          disabled={disabled}
          onClick={() => onSave('pending')}
        >
          Сбросить решение
        </button>
      )}
      {children}
    </div>
  )
}
