import type { Analytics } from './types'

type Cell = string | number

function csvCell(value: Cell) {
  let text = String(value)
  // Filenames and model output are untrusted spreadsheet input.
  if (
    typeof value === 'string' &&
    (/^[\u0000-\u0020]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))
  )
    text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export function analyticsCsv(data: Analytics) {
  const rows: Cell[][] = [
    ['Отчёт по проверкам'],
    ['Часовой пояс', data.timezone],
    ['Начало периода', data.start],
    ['Конец периода', data.end],
    ['Начало сравнения', data.comparison.start],
    ['Конец сравнения', data.comparison.end],
    [],
    ['Показатель', 'Текущий период', 'Предыдущий период'],
  ]
  const metrics: [keyof Analytics['summary'], string][] = [
    ['checks', 'Всего проверок'],
    ['completed', 'Завершено'],
    ['processing', 'В обработке'],
    ['failed', 'Сбои анализа'],
    ['clean', 'Без нарушений'],
    ['with_violations', 'Проверки с нарушениями'],
    ['violations', 'Нарушений'],
    ['duration_sec', 'Длительность видео, сек'],
  ]
  for (const [key, label] of metrics)
    rows.push([label, data.summary[key], data.comparison.summary[key]])
  const decisions = {
    pending: 'Не проверено',
    confirmed: 'Подтверждено',
    insufficient_data: 'Недостаточно данных',
    rejected: 'Отклонено',
  } as const
  if (data.reviews) {
    rows.push([], ['Решения проверяющего'], ['Решение', 'Количество'])
    for (const key of Object.keys(decisions) as (keyof typeof decisions)[])
      rows.push([decisions[key], data.reviews[key]])
  }
  rows.push([], ['Типы нарушений'], ['Код', 'Тип', 'Случаев', 'Проверок'])
  for (const item of data.categories)
    rows.push([item.code || '', item.title, item.count, item.checks])
  rows.push(
    [],
    ['Решения по типам нарушений'],
    [
      'Код',
      'Тип',
      'Подтверждено',
      'Недостаточно данных',
      'Отклонено',
      'Не проверено',
    ]
  )
  for (const item of data.categories)
    if (item.reviews)
      rows.push([
        item.code || '',
        item.title,
        item.reviews.confirmed,
        item.reviews.insufficient_data,
        item.reviews.rejected,
        item.reviews.pending,
      ])
  rows.push(
    [],
    ['Динамика по времени загрузки'],
    ['Начало интервала', 'Проверок', 'Нарушений']
  )
  for (const item of data.timeline)
    rows.push([item.start, item.checks, item.violations])
  rows.push(
    [],
    ['Часы загрузки'],
    ['Час', 'Проверок', 'Завершено', 'С нарушениями', 'Нарушений']
  )
  for (const item of data.hours)
    rows.push([
      item.hour,
      item.checks,
      item.completed,
      item.with_violations,
      item.violations,
    ])
  rows.push(
    [],
    [
      'Последние события',
      data.recent.length,
      'Всего нарушений за период',
      data.summary.violations,
    ],
    [
      'Дата загрузки',
      'Видео',
      'Нарушение',
      'Таймкод, сек',
      'ID проверки',
      'Индекс нарушения',
      'Решение',
    ]
  )
  for (const item of data.recent)
    rows.push([
      item.created_at,
      item.filename,
      item.title,
      item.timecode_sec,
      item.job_id,
      item.violation_index,
      decisions[item.decision || 'pending'],
    ])
  const width = Math.max(...rows.map((row) => row.length))
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        Array.from({ length: width }, (_, index) =>
          csvCell(row[index] ?? '')
        ).join(';')
      )
      .join('\r\n') +
    '\r\n'
  )
}

export function comparisonChange(current: number, previous: number) {
  return {
    difference: current - previous,
    percent: previous > 0 ? ((current - previous) / previous) * 100 : null,
  }
}
