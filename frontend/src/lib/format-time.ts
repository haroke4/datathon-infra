export function formatTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  return `${Math.floor(safe / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(safe % 60)
    .toString()
    .padStart(2, '0')}`
}
