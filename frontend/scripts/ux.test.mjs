import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function loadTs(file) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText
  return import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  )
}
const { validateVideo, readPreference, writePreference, readViewedJobs } =
  await loadTs('../src/lib/preferences.ts')
const { listenForFileDrop } = await loadTs('../src/lib/file-drop.ts')

test('file dragging responds on page entry, stays active across children, and resets on drop or cancellation', () => {
  const page = new EventTarget()
  page.defaultView = Object.assign(new EventTarget(), {
    innerWidth: 1280,
    innerHeight: 832,
  })
  const states = []
  const drops = []
  const cleanup = listenForFileDrop(
    page,
    (state) => states.push(state),
    (files) => drops.push(files)
  )
  const send = (type, props = {}) => {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      clientX: 400,
      clientY: 400,
      dataTransfer: { types: ['Files'], files: [], dropEffect: 'none' },
      ...props,
    })
    page.dispatchEvent(event)
    return event
  }
  try {
    send('dragenter', { dataTransfer: { types: ['text/plain'], files: [] } })
    assert.deepEqual(states, [])
    assert.equal(send('dragenter').defaultPrevented, true)
    assert.deepEqual(states, [true]) // Immediate, before any dragover or drop.
    send('dragenter')
    send('dragleave')
    assert.deepEqual(states, [true]) // Crossing child elements must not flicker.
    assert.equal(send('dragover').dataTransfer.dropEffect, 'copy')
    const file = new File(['video'], 'private-recording.mov')
    const dropped = send('drop', {
      dataTransfer: { types: ['Files'], files: [file] },
    })
    assert.equal(dropped.defaultPrevented, true)
    assert.deepEqual(states, [true, false])
    assert.deepEqual(drops, [[file]])
    send('dragenter')
    send('dragenter')
    send('dragleave', { clientX: 0 })
    assert.equal(states.at(-1), false) // Window exit even with nested enter events.
    send('dragover') // Recover when a browser skips dragenter.
    assert.equal(states.at(-1), true)
    send('keydown', { key: 'Escape' })
    assert.equal(states.at(-1), false)
    send('dragenter')
    page.defaultView.dispatchEvent(new Event('blur'))
    assert.equal(states.at(-1), false)
  } finally {
    cleanup()
  }
  const count = states.length
  send('dragenter')
  assert.equal(states.length, count) // Unmount removes all page listeners.
})

test('reject invalid uploads immediately, without a backend roundtrip', () => {
  assert.match(validateVideo(new File(['test'], 'notes.txt')), /MOV/)
  assert.match(validateVideo(new File([], 'empty.mov')), /пуст/)
  assert.match(
    validateVideo({ name: 'large.mov', size: 100 * 1024 * 1024 + 1 }),
    /100/
  )
  assert.equal(validateVideo(new File(['video'], 'RECORDING.MOV')), null)
  assert.equal(validateVideo(new File(['video'], 'recording.mp4')), null)
  assert.equal(validateVideo(new File(['video'], 'recording.webm')), null)
})
test('drawer and model preferences survive navigation; blocked storage never breaks UI', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const store = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
    },
  })
  try {
    writePreference('forte.drawer', 'open')
    writePreference('forte.model', 'demo-clean')
    assert.equal(readPreference('forte.drawer'), 'open')
    assert.equal(readPreference('forte.model'), 'demo-clean')
    writePreference('forte.drawer', 'closed')
    assert.equal(readPreference('forte.drawer'), 'closed')
    assert.deepEqual([...readViewedJobs()], [])
    writePreference('forte.viewed-jobs', JSON.stringify(['demo-01', 'demo-02']))
    assert.deepEqual([...readViewedJobs()], ['demo-01', 'demo-02'])
    writePreference('forte.viewed-jobs', JSON.stringify(['demo-01', 42, null]))
    assert.deepEqual([...readViewedJobs()], ['demo-01'])
    writePreference('forte.viewed-jobs', '{broken json')
    assert.deepEqual([...readViewedJobs()], [])
    writePreference('forte.viewed-jobs', '{}')
    assert.deepEqual([...readViewedJobs()], [])
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('Storage disabled')
      },
    })
    assert.equal(readPreference('forte.drawer'), null)
    assert.deepEqual([...readViewedJobs()], [])
    assert.doesNotThrow(() => writePreference('forte.drawer', 'open'))
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis, 'localStorage', descriptor)
    else delete globalThis.localStorage
  }
})
test('abandoned mock requests abort promptly and cannot overwrite a newer selection', async () => {
  const { mockFetch } = await loadTs('../src/lib/mock-api.ts')
  const controller = new AbortController()
  const request = mockFetch('/jobs/demo-01', { signal: controller.signal })
  controller.abort()
  await assert.rejects(request, { name: 'AbortError' })
  const newer = await mockFetch('/jobs/demo-02')
  assert.equal((await newer.json()).verdict, 'no_violation')
  await assert.rejects(
    mockFetch('/jobs/demo-01', { signal: controller.signal }),
    { name: 'AbortError' }
  )
})
