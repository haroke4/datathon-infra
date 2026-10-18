import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8')

// Load the real client with Vite's compile-time environment values substituted.
async function loadApi(env = {}) {
  env = { DEV: false, ...env }
  const configured = source
    .replace("import { mockFetch } from './mock-api'", `
      const mockFetch = () => { throw new Error('Unexpected mock request') }
    `)
    .replaceAll('import.meta.env', JSON.stringify(env))
    .replaceAll('import.meta.hot', 'undefined')
  const code = ts.transpileModule(configured, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

test('real API is the default and production cannot enable the browser mock', async () => {
  assert.equal((await loadApi()).isMock, false)
  assert.equal((await loadApi({ DEV: true })).isMock, false)
  assert.equal((await loadApi({ DEV: true, VITE_USE_MOCK_API: 'false' })).isMock, false)
  assert.equal((await loadApi({ DEV: true, VITE_USE_MOCK_API: 'true' })).isMock, true)
  assert.equal((await loadApi({ DEV: false, VITE_USE_MOCK_API: 'true' })).isMock, false)
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
    const file = new File(['video'], 'cash-desk.mov', { type: 'video/quicktime' })
    const uploaded = await api.analyze(file, 'local-default')
    assert.equal(uploaded.job_id, 'accepted-job')
    await api.job('job/with space')
    await api.annotations('job/with space')
    assert.equal(await api.video('job/with space'), '/api/v1/jobs/job%2Fwith%20space/video')
    assert.deepEqual(calls.map(({ url }) => url), [
      '/api/v1/models',
      '/api/v1/jobs',
      '/api/v1/analyze',
      '/api/v1/jobs/job%2Fwith%20space',
      '/api/v1/jobs/job%2Fwith%20space/annotations',
    ])
    const upload = calls[2].options
    assert.equal(upload.method, 'POST')
    assert.ok(upload.body instanceof FormData)
    assert.equal(upload.body.get('file'), file)
    assert.equal(upload.body.get('model_id'), 'local-default')
    assert.equal(upload.headers, undefined) // Browser sets the multipart boundary.
    assert.ok(calls.every(({ options }) => options.credentials === 'include'))
    assert.ok(calls.every(({ options }) => options.signal instanceof AbortSignal))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('API base is configurable and backend errors reach the UI unchanged', async () => {
  const { api } = await loadApi({ DEV: false, VITE_API_BASE_URL: '/api/v1/' })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    assert.equal(url, '/api/v1/jobs/missing')
    return Response.json(
      { error: { code: 'JOB_NOT_FOUND', message: 'Проверка не найдена.' } },
      { status: 404 }
    )
  }
  try {
    await assert.rejects(api.job('missing'), { message: 'Проверка не найдена.' })
  } finally {
    globalThis.fetch = originalFetch
  }
})
