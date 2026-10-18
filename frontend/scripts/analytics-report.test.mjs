import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(
  new URL('../src/lib/analytics-report.ts', import.meta.url),
  'utf8'
)
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText
const { analyticsCsv, comparisonChange } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
)

const summary = {
  checks: 205,
  completed: 200,
  processing: 4,
  failed: 1,
  clean: 50,
  with_violations: 150,
  violations: 300,
  duration_sec: 6200,
}
const data = {
  period: 'month',
  timezone: 'Asia/Almaty',
  start: '2026-09-19T00:00:00+05:00',
  end: '2026-10-18T12:00:00+05:00',
  summary,
  comparison: {
    start: '2026-08-20T00:00:00+05:00',
    end: '2026-09-18T12:00:00+05:00',
    summary: { ...summary, violations: 100 },
  },
  categories: [
    {
      code: 'B1',
      title: 'Купюры; на "столе"\nПосле клиента',
      count: 300,
      checks: 150,
    },
  ],
  timeline: [
    { start: '2026-10-18T00:00:00+05:00', checks: 205, violations: 300 },
  ],
  hours: [
    {
      hour: 9,
      checks: 205,
      completed: 200,
      with_violations: 150,
      violations: 300,
    },
  ],
  recent: [
    {
      created_at: '2026-10-18T01:00:00Z',
      filename: '=HYPERLINK("bad")',
      title: ' \t+FORMULA',
      timecode_sec: 48.5,
      job_id: 'job-1',
      violation_index: 2,
    },
  ],
}

test('CSV report preserves full aggregates, comparison, hours and exact event links', () => {
  const csv = analyticsCsv(data)
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.endsWith('\r\n'))
  assert.ok(csv.includes('"Нарушений";"300";"100"'))
  assert.ok(csv.includes('"Купюры; на ""столе""\nПосле клиента";"300";"150"'))
  assert.ok(csv.includes('"Часы загрузки"'))
  assert.ok(
    csv.includes('"Последние события";"1";"Всего нарушений за период";"300"')
  )
  assert.ok(csv.includes('"48.5";"job-1";"2"'))
  assert.ok(csv.includes('"Часовой пояс";"Asia/Almaty"'))
})

test('untrusted CSV cells cannot become formulas, including leading whitespace', () => {
  const csv = analyticsCsv(data)
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'))
  assert.ok(csv.includes('"\' \t+FORMULA"'))
  for (const prefix of ['=', '+', '-', '@', '\t', '\r', '\n', '   =']) {
    const unsafe = prefix + 'payload'
    const result = analyticsCsv({
      ...data,
      recent: [{ ...data.recent[0], filename: unsafe }],
    })
    assert.ok(result.includes(`"'${unsafe}"`))
  }
})

test('comparison handles absent baseline without infinite or invented percentages', () => {
  assert.deepEqual(comparisonChange(10, 0), { difference: 10, percent: null })
  assert.deepEqual(comparisonChange(0, 0), { difference: 0, percent: null })
  assert.deepEqual(comparisonChange(3, 6), { difference: -3, percent: -50 })
  assert.deepEqual(comparisonChange(9, 6), { difference: 3, percent: 50 })
})

test('review totals and per-event decisions are included in the CSV', () => {
  const counts = {
    pending: 297,
    confirmed: 1,
    insufficient_data: 1,
    rejected: 1,
  }
  const csv = analyticsCsv({
    ...data,
    reviews: counts,
    categories: [{ ...data.categories[0], reviews: counts }],
    recent: [{ ...data.recent[0], decision: 'rejected' }],
  })
  assert.ok(csv.includes('"Подтверждено";"1"'))
  assert.ok(csv.includes('"Недостаточно данных";"1"'))
  assert.ok(csv.includes('"Отклонено";"1"'))
  assert.ok(csv.includes('"Не проверено";"297"'))
  assert.ok(csv.includes('"48.5";"job-1";"2";"Отклонено"'))
})
