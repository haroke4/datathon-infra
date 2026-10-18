import { useEffect, useState } from 'react'
import { VIOLATION_TYPES as CHECKS } from '@/lib/violation-catalog'

const INTERVAL_MS = 1800

export function CheckTicker() {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % CHECKS.length),
      INTERVAL_MS,
    )
    return () => clearInterval(timer)
  }, [])

  const [code, title] = CHECKS[index]
  // Decorative: the heading carries a stable screen-reader label instead.
  return (
    <span key={code} className="check-ticker" aria-hidden="true">
      Проверяется на <span className="check-ticker-code">{code}</span>
      {title}
    </span>
  )
}
