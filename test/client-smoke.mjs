// Smoke test for the browser half: verify the bundle advertises the right
// module id, survives factory evaluation, and registers exactly one row-config
// page while the settings namespace is served.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const clientPath = new URL('../lib/client.js', import.meta.url)
const source = readFileSync(clientPath, 'utf8')
assert.ok(source.includes('window.__ModuleLoader__.load('), 'client bundle must be a ModuleLoader bundle')

const loaded = []
globalThis.window = {
  __ModuleLoader__: {
    load: (entry) => loaded.push(entry),
  },
}

await import(clientPath.href)

assert.equal(loaded.length, 1, 'bundle must call ModuleLoader.load exactly once')
const entry = loaded[0]
assert.equal(entry.id, 'dsh-interim-narration')
assert.equal(typeof entry.factory, 'function')

const react = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: Symbol('Fragment'),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
  useSyncExternalStore: () => undefined,
}
const moduleExports = entry.factory((name) => {
  if (name === 'react') return react
  throw new Error(`unexpected client require: ${name}`)
})
assert.equal(typeof moduleExports.apply, 'function')
assert.deepEqual(moduleExports.inject, ['slots', 'locale', 'configForms'])

// --- fake browser context -------------------------------------------------
const calls = []
const snapshot = {
  status: 'ready',
  writable: true,
  revision: 3,
  value: {
    enabled: true,
    style: 'standard',
    maxSentences: 3,
    minToolCalls: 2,
    language: 'auto',
    debug: false,
    reportBlockers: true,
    ackSteering: true,
  },
  base: null,
  user: null,
}
const scope = {
  getSnapshot: () => snapshot,
  subscribe: () => () => {},
  mutate: async (ops, revision) => calls.push(['mutate', ops, revision]),
}
const registered = {}
const ctx = {
  effect: (fn, label) => {
    calls.push(['effect', label])
    const dispose = fn()
    return () => (typeof dispose === 'function' ? dispose() : undefined)
  },
  locale: {
    bind: (ns) => (key, params) => `${ns}.${key}${params ? JSON.stringify(params) : ''}`,
    register: (ns, dict) => {
      calls.push(['locale.register', ns, Object.keys(dict)])
      return () => {}
    },
  },
  configForms: {
    get: (ns) => {
      calls.push(['configForms.get', ns])
      return scope
    },
    whileServed: (namespaces, register) => {
      calls.push(['whileServed', namespaces])
      return register()
    },
  },
  slots: {
    inject: (name, cb) => {
      calls.push(['slots.inject', name])
      return cb()
    },
    register: (options, Component) => {
      registered[options.key ?? options.name] = { options, Component }
      calls.push(['slots.register', options.name, options.key])
      return () => {}
    },
  },
}

moduleExports.apply(ctx)

assert.ok(calls.some(([k, ns]) => k === 'locale.register' && ns === 'interimNarration'))
assert.ok(calls.some(([k, namespaces]) => k === 'whileServed' && namespaces.includes('dsh-interim-narration')))
assert.ok(calls.some(([k, name, key]) => k === 'slots.register' && name === 'plugins.row.config' && key === 'dsh-interim-narration#dsh-interim-narration'))

const page = registered['dsh-interim-narration#dsh-interim-narration']
assert.ok(page, 'row config page must be registered')
assert.equal(page.options.order, 40)
assert.equal(page.options.locale, 'interimNarration')

const summary = page.Component({ view: 'summary', t: (key) => key })
assert.ok(summary, 'summary view must render something')

const rendered = page.Component({ view: 'page', t: (key) => key, scope })
assert.ok(rendered && typeof rendered.type === 'function', 'page view must render the settings component')
const container = rendered.type(rendered.props)
assert.equal(container.type, 'div', 'settings component must render a container element')

console.log('client smoke: all assertions passed')
