import { Check, HelpCircle, ListChecks, X } from 'lucide-react'
import { REVIEW_DECISIONS } from '@/lib/review-notes'
import type { ReviewCounts, ReviewDecision } from '@/lib/types'

type Props = {
  counts?: ReviewCounts
  selected: ReviewDecision | 'all'
  onSelect: (decision: ReviewDecision | 'all') => void
}
const categories = [
  { key: 'confirmed', Icon: Check },
  { key: 'insufficient_data', Icon: HelpCircle },
  { key: 'rejected', Icon: X },
  { key: 'pending', Icon: ListChecks },
] as const

export function ReviewStatistics({ counts, selected, onSelect }: Props) {
  if (!counts) return null
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const reviewed = total - counts.pending
  return (
    <section
      className="review-statistics"
      aria-labelledby="review-statistics-title"
    >
      <div className="review-statistics-heading">
        <h2 id="review-statistics-title">Решения проверяющего</h2>
        <span>
          С решением: {reviewed} из {total}
        </span>
      </div>
      <div className="review-statistics-grid">
        {categories.map(({ key, Icon }) => (
          <button
            key={key}
            className={`review-statistic review-statistic-${key}`}
            aria-pressed={selected === key}
            onClick={() => onSelect(selected === key ? 'all' : key)}
          >
            <span>
              <Icon size={15} />
              {REVIEW_DECISIONS[key]}
            </span>
            <strong>{counts[key]}</strong>
            <small>
              {total ? Math.round((counts[key] / total) * 100) : 0}% событий
            </small>
          </button>
        ))}
      </div>
      <p>
        Решения относятся к событиям из видео, загруженных за выбранный период.
        Исходные находки модели сохраняются в общей статистике.
      </p>
    </section>
  )
}
