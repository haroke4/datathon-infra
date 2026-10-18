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
const load = (suffix = '') =>
  import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${suffix}`
  )

test('saved decisions survive reload, appear in analytics, and never replace model findings', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const storage = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  })
  try {
    const { mockFetch } = await load()
    const original = await (await mockFetch('/jobs/demo-01')).json()
    const getReviews = async (fetch = mockFetch) =>
      (await (await fetch('/jobs/demo-01/reviews')).json()).reviews
    const [first, second] = await getReviews()
    assert.deepEqual([first.decision, second.decision], ['pending', 'pending'])
    const put = (review, decision, signal) =>
      mockFetch(`/jobs/demo-01/violations/${review.violation_index}/review`, {
        method: 'PUT',
        signal,
        body: JSON.stringify({ decision, violation_key: review.violation_key }),
      })
    assert.equal((await put(first, 'confirmed')).status, 200)
    assert.equal((await put(second, 'insufficient_data')).status, 200)
    assert.equal((await put(first, 'confirmed')).status, 200)
    const reloaded = await load('new-page')
    assert.deepEqual(
      (await getReviews(reloaded.mockFetch)).map((item) => item.decision),
      ['confirmed', 'insufficient_data']
    )
    const data = await (
      await reloaded.mockFetch('/analytics?period=month')
    ).json()
    assert.equal(data.reviews.confirmed, 1)
    assert.equal(data.reviews.insufficient_data, 1)
    assert.equal(
      Object.values(data.reviews).reduce((sum, count) => sum + count, 0),
      data.summary.violations
    )
    assert.equal(
      data.recent.find(
        (item) => item.job_id === 'demo-01' && item.violation_index === 0
      ).decision,
      'confirmed'
    )
    assert.deepEqual(await (await mockFetch('/jobs/demo-01')).json(), original)
    assert.equal((await put(first, 'rejected')).status, 200)
    assert.equal((await put(second, 'pending')).status, 200)
    assert.deepEqual(
      (await getReviews()).map((item) => item.decision),
      ['rejected', 'pending']
    )
    assert.equal(
      (await put({ ...first, violation_key: 'f'.repeat(64) }, 'confirmed'))
        .status,
      409
    )
    assert.equal((await put(first, 'invented')).status, 422)
    assert.equal(
      (await put({ ...first, violation_index: 9 }, 'confirmed')).status,
      404
    )
    assert.equal((await mockFetch('/jobs/demo-02/reviews')).status, 200)
    const aborted = new AbortController()
    const pending = put(first, 'confirmed', aborted.signal)
    aborted.abort()
    await assert.rejects(pending, { name: 'AbortError' })
    assert.equal((await getReviews())[0].decision, 'rejected')
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis, 'localStorage', descriptor)
    else delete globalThis.localStorage
  }
})
