// Preferences must not break the interface when browser storage is unavailable.
export function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
export function writePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* The current session still works. */
  }
}
export function readViewedJobs(): Set<string> {
  try {
    const saved: unknown = JSON.parse(
      readPreference('forte.viewed-jobs') || '[]'
    )
    return new Set(
      Array.isArray(saved)
        ? saved.filter((id): id is string => typeof id === 'string')
        : []
    )
  } catch {
    return new Set()
  }
}
export function validateVideo(file: File): string | null {
  if (!/\.(mov|mp4|webm)$/i.test(file.name))
    return 'Поддерживаются видео в форматах MOV, MP4 и WebM.'
  if (!file.size) return 'Этот файл пуст. Выберите другое видео.'
  if (file.size > 100 * 1024 * 1024)
    return 'Файл слишком большой. Максимальный размер — 100 МБ.'
  return null
}
