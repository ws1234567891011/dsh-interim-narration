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
    announcePlan: true,
    reminder: true,
    enforce: true,
    escalateAfter: 1,
  },
  base: null,
  user: null,
}
const scope = {
  getSnapshot: () => snapshot,
  subscribe: () => () => {},
  mutate: async (ops, revision) => calls.push(['mutate', ops, revision]),
}

// The Chat display namespace (`ui-chat`) is a separate form with its own
// snapshot; the display block reads and writes it only on user action.
const chatSnapshot = {
  status: 'ready',
  writable: true,
  revision: 7,
  value: { transcriptView: 'standard', collapseTiming: 'next-input', performanceUsage: 'detailed' },
}
const chatScope = {
  getSnapshot: () => chatSnapshot,
  subscribe: () => () => {},
  mutate: async (ops, revision) => calls.push(['chat-mutate', ops, revision]),
}

const registered = {}
const commandRegistrations = []
const commandUi = {
  register: (contribution) => {
    commandRegistrations.push(contribution)
    calls.push(['command.register', contribution.name])
    return () => {}
  },
  decorate: () => () => {},
}
const ctx = {
  effect: (fn, label) => {
    calls.push(['effect', label])
    const dispose = fn()
    return () => (typeof dispose === 'function' ? dispose() : undefined)
  },
  inject: (names, cb) => {
    calls.push(['inject', names])
    const available = { commandUi }
    if (names.every((name) => available[name])) {
      // Mirror cordis: the callback receives a child context that inherits the
      // parent's methods and only adds service lookups for the injected names.
      const child = Object.create(ctx)
      child.get = (name) => available[name]
      cb(child)
    }
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
      return ns === 'ui-chat' ? chatScope : scope
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
assert.ok(calls.some(([k, ns]) => k === 'configForms.get' && ns === 'ui-chat'), 'display block must bind ui-chat')
assert.ok(calls.some(([k, name, key]) => k === 'slots.register' && name === 'plugins.row.config' && key === 'dsh-interim-narration#dsh-interim-narration'))

const page = registered['dsh-interim-narration#dsh-interim-narration']
assert.ok(page, 'row config page must be registered')
assert.equal(page.options.order, 40)
assert.equal(page.options.locale, 'interimNarration')

const summary = page.Component({ view: 'summary', t: (key) => key })
assert.ok(summary, 'summary view must render something')

const rendered = page.Component({ view: 'page', t: (key) => key, scope, chatScope })
assert.ok(rendered && typeof rendered.type === 'function', 'page view must render the settings component')
const container = rendered.type(rendered.props)
assert.equal(container.type, 'div', 'settings component must render a container element')

const tree = JSON.stringify(container)
assert.ok(tree.includes('visibilityTitle'), 'page must render the display block')
assert.ok(tree.includes('visibilityNote'), 'display block must explain the settings equivalent')
assert.ok(tree.includes('presetVisible'), 'display block must offer the recommended preset')
assert.ok(tree.includes('enforce'), 'page must expose the enforcement toggle')

// Changing a display select writes the Chat namespace through the settings
// service, not the plugin namespace.
function findNodes(node, predicate, found = []) {
  if (node === null || typeof node !== 'object') return found
  if (predicate(node)) found.push(node)
  for (const child of node.children ?? []) findNodes(child, predicate, found)
  for (const child of Object.values(node.props ?? {})) findNodes(child, predicate, found)
  return found
}
const chatSelects = findNodes(
  container,
  (node) => node.type === 'select' && (node.children ?? []).some((child) => child?.props?.value === 'compact'),
)
assert.equal(chatSelects.length, 1, 'expected the transcriptView select to render')
assert.equal(chatSelects[0].props.value, 'standard', 'transcriptView select must show the current value')
chatSelects[0].props.onChange({ currentTarget: { value: 'verbose' } })
assert.ok(
  calls.some(([k, ops, rev]) => k === 'chat-mutate' && rev === 7 && JSON.stringify(ops) === JSON.stringify([
    { op: 'set', path: ['transcriptView'], value: 'verbose' },
  ])),
  'display control must mutate ui-chat with the live revision',
)

// The preset button writes both display fields in one save.
const presetButton = findNodes(
  container,
  (node) => node.type === 'button' && String(node.children?.[0] ?? '').endsWith('presetVisible'),
)[0]
assert.ok(presetButton, 'preset button must exist')
presetButton.props.onClick()
assert.ok(
  calls.some(([k, ops]) =>
    k === 'chat-mutate' &&
    JSON.stringify(ops) === JSON.stringify([
      { op: 'set', path: ['transcriptView'], value: 'detailed' },
      { op: 'set', path: ['collapseTiming'], value: 'next-input' },
    ]),
  ),
  'preset must write transcriptView + collapseTiming together',
)

// The plugin's own fields are still saved through its own namespace.
const saveButton = findNodes(
  container,
  (node) => node.type === 'button' && String(node.children?.[0] ?? '').endsWith('save'),
)[0]
assert.ok(saveButton, 'save button must exist')

// --- `/narration` command ---------------------------------------------------
const command = commandRegistrations[0]
assert.ok(command, 'apply must register the /narration command')
assert.equal(command.name, 'narration')
assert.equal(typeof command.label, 'function')
assert.equal(typeof command.description, 'function')
assert.equal(command.available({}), true)
assert.equal(command.ui.kind, 'popupSelect')
assert.equal(command.ui.searchMode, 'substring')
const commandLabels = command.ui.searchLabels()
assert.equal(typeof commandLabels.placeholder, 'string')
const commandRows = await command.ui.options()
assert.ok(commandRows.some((row) => row.id === 'style:standard' && row.active === true), 'active style row must be marked')
assert.ok(commandRows.some((row) => row.id === 'toggle-enable'))
assert.ok(commandRows.some((row) => row.id === 'display-visible'))
assert.ok(commandRows.some((row) => row.id === 'display-default'))

await command.ui.onSelect({ id: 'style:verbose' })
assert.ok(
  calls.some(([k, ops, rev]) => k === 'mutate' && rev === 3 && JSON.stringify(ops) === JSON.stringify([
    { op: 'set', path: ['style'], value: 'verbose' },
  ])),
  '/narration style pick must write the narration namespace',
)
await command.ui.onSelect({ id: 'toggle-enable' })
assert.ok(
  calls.some(([k, ops]) => k === 'mutate' && JSON.stringify(ops) === JSON.stringify([
    { op: 'set', path: ['enabled'], value: false },
  ])),
  '/narration toggle must flip enabled',
)
await command.ui.onSelect({ id: 'display-visible' })
assert.ok(
  calls.some(([k, ops]) => k === 'chat-mutate' && JSON.stringify(ops) === JSON.stringify([
    { op: 'set', path: ['transcriptView'], value: 'detailed' },
    { op: 'set', path: ['collapseTiming'], value: 'next-input' },
  ])),
  '/narration display preset must write ui-chat',
)

// --- reset controls --------------------------------------------------------
const resetButtons = findNodes(
  container,
  (node) => node.type === 'button' && String(node.props?.title ?? '').endsWith('resetField'),
)
assert.ok(resetButtons.length >= 12, 'every editable field must offer a reset button')
await resetButtons[0].props.onClick()
assert.ok(
  calls.some(([k, ops]) => k === 'mutate' && JSON.stringify(ops) === JSON.stringify([
    { op: 'unset', path: ['style'] },
  ])),
  'reset must send an unset op for that field',
)
const resetAllButton = findNodes(
  container,
  (node) => node.type === 'button' && String(node.children?.[0] ?? '').endsWith('resetAll'),
)[0]
assert.ok(resetAllButton, 'reset-all button must exist')
await resetAllButton.props.onClick()
assert.ok(
  calls.some(([k, ops]) => k === 'mutate' && Array.isArray(ops) && ops.length === 12 && ops.every((op) => op.op === 'unset')),
  'reset-all must unset all editable fields at once',
)

console.log('client smoke: all assertions passed')
