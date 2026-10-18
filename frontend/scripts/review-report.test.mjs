import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const cache = new Map()
async function loadModule(path) {
  if (cache.has(path)) return cache.get(path)
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  let code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  for (const [, specifier] of code.matchAll(/from ['"]([^'"]+)['"]/g)) {
    let url
    if (specifier.endsWith('?url')) url = 'data:text/javascript,export default "font.ttf"'
    else if (specifier.startsWith('.')) url = await loadModule(`../src/lib/${specifier.slice(2)}.ts`)
    else url = pathToFileURL(require.resolve(specifier)).href
    code = code.replaceAll(`from '${specifier}'`, `from '${url}'`).replaceAll(`from "${specifier}"`, `from '${url}'`)
  }
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  cache.set(path, url)
  return url
}
const { createReviewPdf } = await import(await loadModule('../src/lib/review-report.ts'))
const { readReviewNotes, saveReviewNotes, reviewNoteKey } = await import(await loadModule('../src/lib/review-notes.ts'))
const { eventSources, eventDescription } = await import(await loadModule('../src/lib/review-event.ts'))
const font = (await readFile(new URL('../src/assets/NotoSans-Regular.ttf', import.meta.url))).toString('base64')
const event = {
  code: 'B9', type: 'Незаблокированное рабочее место', timecode_sec: 17,
  description: 'Кассир покинул рабочее место. Норма: выдержка из документа.',
  evidence_frames: [], sources: [{ label: '№53, п.71 пп.9', url: 'https://example.com/rule#71' }],
  source_note: 'Не показывать в карточке.',
}
const input = {
  filename: 'Касса №1.mov', createdAt: '2026-10-18T05:16:00Z',
  job: { job_id: 'report-test', status: 'done', verdict: 'violation', violations: [event] },
  annotations: { duration_sec: 25, events: [] }, notes: {},
}

test('PDF exports Unicode text and clickable normative references', () => {
  const doc = createReviewPdf(input, font)
  const pdf = doc.output()
  assert.ok(pdf.startsWith('%PDF-'))
  assert.match(pdf, /\/URI \(https:\/\/example.com\/rule#71\)/)
  assert.match(pdf, /\/FontFile2/)
  assert.match(pdf, /\/ToUnicode/)
  assert.equal(doc.getNumberOfPages(), 1)
})

test('long comments paginate and every event survives export, including missing and invalid frames', () => {
  const notes = { [reviewNoteKey(event, 0)]: { decision: 'confirmed', comment: 'Длинный комментарий. '.repeat(250) } }
  const doc = createReviewPdf({ ...input, notes, job: { ...input.job, violations: [event, { ...event, evidence_frames: [{ timestamp_sec: 18, image_base64: 'broken' }] }] } }, font)
  assert.ok(doc.getNumberOfPages() > 2)
  assert.equal((doc.output().match(/\/URI \(https:\/\/example.com\/rule#71\)/g) || []).length, 2)
  const clean = createReviewPdf({ ...input, job: { ...input.job, verdict: 'no_violation', violations: [] } }, font)
  assert.equal(clean.getNumberOfPages(), 1)
})

test('catalog sources and annotation fallback share a clean explanation', () => {
  assert.deepEqual(eventSources(event), event.sources)
  assert.equal(eventDescription(event), 'Кассир покинул рабочее место.')
  const annotation = { rule: { title: 'Правило', section: 'п.1', url: 'https://example.com' } }
  assert.deepEqual(eventSources({ ...event, sources: [] }, annotation), [{ label: 'Правило, п.1', url: 'https://example.com' }])
  assert.equal(eventDescription({ ...event, sources: [] }, annotation), 'Кассир покинул рабочее место.')
  assert.deepEqual(eventSources({ ...event, sources: [] }), [])
})

test('review notes persist per job and event; malformed storage is discarded', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const store = new Map()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key) => store.get(key), setItem: (key, value) => store.set(key, value) } })
  try {
    const key = reviewNoteKey(event, 0)
    const notes = { [key]: { decision: 'rejected', comment: 'Проверено вручную.' } }
    saveReviewNotes('one', notes)
    assert.deepEqual(readReviewNotes('one'), notes)
    assert.deepEqual(readReviewNotes('two'), {})
    assert.notEqual(reviewNoteKey({ ...event, timecode_sec: 20 }, 0), key)
    store.set('forte.review-notes.one', JSON.stringify({ bad: { decision: 'toString', comment: 'bad' }, valid: notes[key] }))
    assert.deepEqual(readReviewNotes('one'), { valid: notes[key] })
    for (const value of ['broken', 'null', '[]', '42']) {
      store.set('forte.review-notes.one', value)
      assert.deepEqual(readReviewNotes('one'), {})
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  }
})
