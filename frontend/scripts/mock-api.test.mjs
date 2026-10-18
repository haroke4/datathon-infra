import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Test the real mock transport with a minimal metadata element (no media decoder).
const source = await readFile(new URL('../src/lib/mock-api.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { mockFetch } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
let clock = Date.now()
const originalNow = Date.now
const realDocument = globalThis.document
Date.now = () => clock
globalThis.document = {
  createElement: () => ({ duration: 65, removeAttribute() {}, load() {}, set src(_) { queueMicrotask(() => this.onloadedmetadata?.()) } }),
}
const upload = (name, model = 'local-default', content = 'test video') => {
  const body = new FormData()
  body.set('file', new File([content], name))
  body.set('model_id', model)
  return mockFetch('/analyze', { method: 'POST', body })
}

test('models, history, upload validation, serial queue, jury results, annotations and media', async () => {
  try {
    assert.equal((await (await mockFetch('/models')).json()).models.length, 3)
    assert.equal((await (await mockFetch('/jobs')).json()).jobs.length, 4)
    assert.equal((await upload('notes.txt')).status, 415)
    assert.equal((await upload('empty.mov', 'local-default', '')).status, 400)
    assert.equal((await upload('video.mov', 'missing-model')).status, 400)
    const missing = await mockFetch('/analyze', { method: 'POST', body: new FormData() })
    assert.equal(missing.status, 400)
    const response = await upload('first.mov')
    assert.equal(response.status, 202)
    const first = await response.json()
    const second = await (await upload('second.mp4', 'demo-clean')).json()
    assert.equal((await (await mockFetch(`/jobs/${first.job_id}`)).json()).queue_position, 0)
    assert.equal((await (await mockFetch(`/jobs/${second.job_id}`)).json()).queue_position, 1)
    assert.equal((await mockFetch(`/jobs/${first.job_id}/annotations`)).status, 409)
    clock += 19000
    const result = await (await mockFetch(`/jobs/${first.job_id}`)).json()
    assert.equal(result.status, 'done')
    assert.equal(result.verdict, 'violation')
    assert.equal(result.violations.length, 2)
    assert.equal(result.violations[0].timecode_sec, 32)
    for (const violation of result.violations) {
      assert.ok(violation.type && violation.description)
      assert.ok(Array.isArray(violation.evidence_frames))
    }
    const queued = await (await mockFetch(`/jobs/${second.job_id}`)).json()
    assert.equal(queued.status, 'processing')
    assert.equal(queued.queue_position, 0)
    const details = await (await mockFetch(`/jobs/${first.job_id}/annotations`)).json()
    assert.equal(details.duration_sec, 65)
    for (const event of details.events) {
      assert.ok(event.start_sec <= event.end_sec && event.end_sec <= details.duration_sec)
      assert.ok(event.box.x + event.box.width <= 1 && event.box.y + event.box.height <= 1)
      assert.equal(event.rule, null)
    }
    assert.equal((await mockFetch(`/jobs/${first.job_id}/video`)).status, 200)
    assert.equal((await mockFetch('/jobs/demo-01/video')).status, 404)
    clock += 19000
    const clean = await (await mockFetch(`/jobs/${second.job_id}`)).json()
    assert.equal(clean.verdict, 'no_violation')
    assert.deepEqual(clean.violations, [])
    assert.equal((await mockFetch('/jobs/does-not-exist')).status, 404)
  } finally {
    Date.now = originalNow
    globalThis.document = realDocument
  }
})
