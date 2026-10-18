import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(
  new URL('../src/lib/api.ts', import.meta.url),
  'utf8'
)

// Load the real client with Vite's compile-time environment values substituted.
async function loadApi(env = {}) {
  env = { DEV: false, ...env }
  const configured = source
    .replace(
      "import { mockFetch } from './mock-api'",
      `
      const mockFetch = () => { throw new Error('Unexpected mock request') }
    `
    )
    .replaceAll('import.meta.env', JSON.stringify(env))
    .replaceAll('import.meta.hot', 'undefined')
  const code = ts.transpileModule(configured, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText
  return import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  )
}

test('real API is the default and production cannot enable the browser mock', async () => {
  assert.equal((await loadApi()).isMock, false)
  assert.equal((await loadApi({ DEV: true })).isMock, false)
  assert.equal(
    (await loadApi({ DEV: true, VITE_USE_MOCK_API: 'false' })).isMock,
    false
  )
  assert.equal(
    (await loadApi({ DEV: true, VITE_USE_MOCK_API: 'true' })).isMock,
    true
  )
  assert.equal(
    (await loadApi({ DEV: false, VITE_USE_MOCK_API: 'true' })).isMock,
    false
  )
})

test('real client uses backend routes, multipart fields, encoded IDs and same-origin media', async () => {
  const { api } = await loadApi({ DEV: false })
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return Response.json({ job_id: 'accepted-job', models: [], jobs: [] })
  }
  try {
    await api.models()
    await api.history()
    const file = new File(['video'], 'cash-desk.mov', {
      type: 'video/quicktime',
    })
    const uploaded = await api.analyze(file, 'local-default')
    assert.equal(uploaded.job_id, 'accepted-job')
    await api.job('job/with space')
    await api.annotations('job/with space')
    assert.equal(
      await api.video('job/with space'),
      '/api/ui/jobs/job%2Fwith%20space/video'
    )
    assert.deepEqual(
      calls.map(({ url }) => url),
      [
        '/api/ui/models',
        '/api/ui/jobs',
        '/api/ui/analyze',
        '/api/ui/jobs/job%2Fwith%20space',
        '/api/ui/jobs/job%2Fwith%20space/annotations',
      ]
    )
    const upload = calls[2].options
    assert.equal(upload.method, 'POST')
    assert.ok(upload.body instanceof FormData)
    assert.equal(upload.body.get('file'), file)
    assert.equal(upload.body.get('model_id'), 'local-default')
    assert.equal(upload.headers, undefined) // Browser sets the multipart boundary.
    assert.ok(calls.every(({ options }) => options.credentials === 'include'))
    assert.ok(
      calls.every(({ options }) => options.signal instanceof AbortSignal)
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('API base is configurable and backend errors reach the UI unchanged', async () => {
  const { api } = await loadApi({ DEV: false, VITE_API_BASE_URL: '/api/ui/' })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    assert.equal(url, '/api/ui/jobs/missing')
    return Response.json(
      { error: { code: 'JOB_NOT_FOUND', message: 'Проверка не найдена.' } },
      { status: 404 }
    )
  }
  try {
    await assert.rejects(api.job('missing'), {
      message: 'Проверка не найдена.',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('analytics sends selected period, viewer timezone and cancellation signal', async () => {
  const { api } = await loadApi()
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  globalThis.fetch = async (url, options) => {
    const request = new URL(url, 'http://test')
    assert.equal(request.pathname, '/api/ui/analytics')
    assert.equal(request.searchParams.get('period'), 'week')
    assert.equal(
      request.searchParams.get('timezone'),
      Intl.DateTimeFormat().resolvedOptions().timeZone
    )
    assert.ok(options.signal instanceof AbortSignal)
    return Response.json({ summary: { checks: 12 } })
  }
  try {
    assert.equal(
      (await api.analytics('week', controller.signal)).summary.checks,
      12
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('review decisions use independent read/write routes with an event identity and cancellation', async () => {
  const { api } = await loadApi()
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return Response.json({ reviews: [], decision: 'confirmed' })
  }
  try {
    const controller = new AbortController()
    const review = {
      violation_index: 3,
      violation_key: 'a'.repeat(64),
      decision: 'pending',
      updated_at: null,
    }
    await api.reviews('job/1', controller.signal)
    await api.reviewDecision('job/1', review, 'confirmed', controller.signal)
    assert.deepEqual(
      calls.map((call) => call.url),
      [
        '/api/ui/jobs/job%2F1/reviews',
        '/api/ui/jobs/job%2F1/violations/3/review',
      ]
    )
    assert.equal(calls[1].options.method, 'PUT')
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      decision: 'confirmed',
      violation_key: review.violation_key,
    })
    assert.equal(calls[1].options.headers['Content-Type'], 'application/json')
    assert.ok(calls.every((call) => call.options.signal instanceof AbortSignal))
  } finally {
    globalThis.fetch = originalFetch
  }
})
