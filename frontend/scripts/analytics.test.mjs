import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(
  new URL('../src/lib/mock-api.ts', import.meta.url),
  'utf8'
)
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText
const { mockFetch } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
)

test('analytics periods reconcile timeline, repeated categories, checks and event links', async () => {
  let previous = 0
  for (const [period, buckets] of [
    ['today', 24],
    ['week', 7],
    ['month', 30],
  ]) {
    const response = await mockFetch(`/analytics?period=${period}`)
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.period, period)
    if (period !== 'today') assert.equal(data.timeline.length, buckets)
    assert.ok(data.summary.checks >= previous)
    previous = data.summary.checks
    assert.equal(
      data.summary.checks,
      data.summary.completed + data.summary.processing + data.summary.failed
    )
    assert.equal(
      data.summary.completed,
      data.summary.clean + data.summary.with_violations
    )
    assert.equal(
      data.summary.violations,
      data.categories.reduce((sum, item) => sum + item.count, 0)
    )
    assert.equal(
      data.summary.violations,
      data.timeline.reduce((sum, item) => sum + item.violations, 0)
    )
    assert.equal(
      data.summary.checks,
      data.timeline.reduce((sum, item) => sum + item.checks, 0)
    )
    assert.equal(data.summary.violations, data.recent.length)
    assert.equal(data.hours.length, 24)
    assert.equal(
      data.hours.reduce((sum, item) => sum + item.checks, 0),
      data.summary.checks
    )
    assert.equal(
      data.hours.reduce((sum, item) => sum + item.violations, 0),
      data.summary.violations
    )
    assert.equal(
      data.comparison.summary.completed,
      data.comparison.summary.clean + data.comparison.summary.with_violations
    )
    assert.ok(new Date(data.comparison.end) < new Date(data.start))
    for (const event of data.recent.slice(0, 2)) {
      const job = await (await mockFetch(`/jobs/${event.job_id}`)).json()
      assert.equal(
        job.violations[event.violation_index].timecode_sec,
        event.timecode_sec
      )
    }
  }
})

test('analytics requests can be cancelled when changing the period', async () => {
  const controller = new AbortController()
  const pending = mockFetch('/analytics?period=month', {
    signal: controller.signal,
  })
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})
