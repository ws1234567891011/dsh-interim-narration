// Smoke test for the browser half: verify the bundle advertises the right
// module id, survives factory evaluation, and registers the row-config page
// plus the top-level Settings section while the settings namespace is served.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildPreview as hostBuildPreview, resolveConfig as hostResolveConfig } from '../lib/core.js'

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
    contract: 'full',
    maxSentences: 0,
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
  value: { transcriptView: 'standard', collapseTiming: 'next-input', foldedReplies: 'all', performanceUsage: 'detailed' },
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

// v0.10.0: the same page is also a top-level Settings section.
assert.ok(calls.some(([k, name]) => k === 'slots.inject' && name === 'settings.section'))
const section = registered['settings.section']
assert.ok(section, 'settings section must be registered')
assert.equal(section.options.id, 'interim-narration', 'settings section id must be stable')
assert.equal(section.options.order, 22, 'settings section must sit right after the built-in pages')
assert.equal(section.options.locale, 'interimNarration')
const sectionNode = section.Component({ view: 'page', t: (key) => key })
assert.ok(sectionNode && typeof sectionNode.type === 'function', 'settings section must render the settings page')
assert.equal(sectionNode.type(sectionNode.props).type, 'div', 'settings section must render a container')

// Sidebar entry: the page can also live as its own panel.
assert.ok(
  calls.some(
    ([k, name, key]) => k === 'slots.register' && name === 'main' && key === 'interim-narration',
  ),
  'main panel must be registered under the stable id',
)
const sidebar = registered['sidebar.panellist']
assert.ok(sidebar, 'sidebar entry must be registered when the slot exists')
assert.equal(sidebar.options.id, 'interim-narration')
assert.equal(sidebar.options.locale, 'interimNarration')
const row = sidebar.Component({ size: 16 })
assert.equal(typeof row.type, 'function', 'sidebar row renders the icon component')
const icon = row.type({ size: 16 })
assert.equal(icon.type, 'svg', 'sidebar row must render an icon')

const summary = page.Component({ view: 'summary', t: (key) => key })
assert.ok(summary, 'summary view must render something')

const rendered = page.Component({ view: 'page', t: (key) => key, scope, chatScope })
assert.ok(rendered && typeof rendered.type === 'function', 'page view must render the settings component')
const container = rendered.type(rendered.props)
assert.equal(container.type, 'div', 'settings component must render a container element')

const tree = JSON.stringify(container)
assert.ok(tree.includes('visibilityTitle') || tree.includes('sectionDisplay'), 'page must render the display block')
assert.ok(tree.includes('tabBasic'), 'page must group the basics')
assert.ok(tree.includes('tabPrompt'), 'page must group the opening and reminder toggles')
assert.ok(tree.includes('tabAdvanced'), 'page must group the advanced fields')
assert.ok(tree.includes('maxSentencesFollow'), 'a zero sentence budget must explain that the preset decides')
assert.ok(tree.includes('visibilityNote'), 'display block must explain the settings equivalent')
assert.ok(tree.includes('sectionInterjection'), 'page must expose the local fold patch block')
assert.ok(tree.includes('introBasic'), 'every tab must open with a plain-language intro')
assert.ok(tree.includes('introInterjection'), 'the interjection tab must explain what it is for')
assert.ok(tree.includes('interjectionExample'), 'the interjection tab must include a concrete example')
assert.ok(tree.includes('interjectionEffect'), 'the interjection tab must say what the patch does not change')
assert.ok(
  tree.includes('interjectionEnable') && tree.includes('interjectionDisable'),
  'patch block must offer enable and revert actions',
)
assert.ok(tree.includes('interjectionNote'), 'patch block must explain the local-only caveat')
assert.ok(tree.includes('presetCollapse') && tree.includes('presetExpand'), 'display block must offer both presets')
assert.ok(tree.includes('enforce'), 'page must expose the enforcement toggle')
const tabButtons = findNodes(
  container,
  (node) => node.type === 'button' && (node.children ?? []).some((child) => String(child).endsWith('tabPrompt')),
)
assert.equal(tabButtons.length, 1, 'page must render a horizontal tab for each group')
assert.ok(
  findNodes(container, (node) => node.type === 'button' && (node.children ?? []).some((child) => String(child).endsWith('tabInterjection'))).length === 1,
  'the interjection block must have its own tab',
)

// --- v0.8.0: contract preset and prompt preview -----------------------------
assert.ok(tree.includes('contract'), 'page must expose the prompt contract preset')
assert.ok(tree.includes('previewTitle'), 'page must render the prompt preview block')
assert.ok(tree.includes('previewMeta'), 'preview must show a size estimate')
assert.ok(
  findNodes(container, (node) => node.type === 'pre').length === 1,
  'preview must render one preformatted prompt body',
)
const contractSelect = findNodes(
  container,
  (node) => node.type === 'select' && (node.children ?? []).some((child) => child?.props?.value === 'full'),
)[0]
assert.ok(contractSelect, 'contract select must render')
assert.equal(contractSelect.props.value, 'full', 'contract select must show the current value')

// The preview must equal the host's builders for every interesting config.
const matrix = [
  {},
  { style: 'concise' },
  { style: 'verbose', maxSentences: 2 },
  { contract: 'compact' },
  { contract: 'compact', language: 'en' },
  { language: 'en', announcePlan: false },
  { enabled: false },
  { reminder: false },
  { reportBlockers: false, ackSteering: false },
]
for (const raw of matrix) {
  const local = moduleExports.__preview(raw)
  const host = hostBuildPreview(hostResolveConfig(raw))
  assert.deepEqual(local, host, `preview drifted from the host for ${JSON.stringify(raw)}`)
}

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
  (node) => node.type === 'select' && (node.children ?? []).some((child) => child?.props?.value === 'detailed'),
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

// ui-chat 0.2.2 added foldedReplies; the page must expose it so a folded turn
// can keep only the final answer and drop the interim narration paragraphs.
const replySelects = findNodes(
  container,
  (node) => node.type === 'select' && (node.children ?? []).some((child) => child?.props?.value === 'final'),
)
assert.equal(replySelects.length, 1, 'expected the foldedReplies select to render')
assert.equal(replySelects[0].props.value, 'all', 'foldedReplies select must show the current value')

const maxSentencesInput = findNodes(
  container,
  (node) => node.type === 'input' && node.props?.type === 'number' && node.props?.min === 0,
)[0]
assert.ok(maxSentencesInput, 'the sentence budget input must allow 0 (follow the preset)')

// The presets write both display fields in one save: folded by default, and a
// second button for the fully-expanded mode.
const collapseButton = findNodes(
  container,
  (node) => node.type === 'button' && String(node.children?.[0] ?? '').endsWith('presetCollapse'),
)[0]
assert.ok(collapseButton, 'collapse preset button must exist')
collapseButton.props.onClick()
assert.ok(
  calls.some(([k, ops]) =>
    k === 'chat-mutate' &&
    JSON.stringify(ops) === JSON.stringify([
      { op: 'set', path: ['transcriptView'], value: 'standard' },
      { op: 'set', path: ['collapseTiming'], value: 'completion' },
      { op: 'set', path: ['foldedReplies'], value: 'final' },
    ]),
  ),
  'collapse preset must set standard + completion + final-only replies',
)

const expandButton = findNodes(
  container,
  (node) => node.type === 'button' && String(node.children?.[0] ?? '').endsWith('presetExpand'),
)[0]
assert.ok(expandButton, 'expand preset button must exist')
expandButton.props.onClick()
assert.ok(
  calls.some(([k, ops]) =>
    k === 'chat-mutate' &&
    JSON.stringify(ops) === JSON.stringify([
      { op: 'set', path: ['transcriptView'], value: 'detailed' },
      { op: 'set', path: ['collapseTiming'], value: 'next-input' },
      { op: 'set', path: ['foldedReplies'], value: 'all' },
    ]),
  ),
  'expand preset must set detailed + next-input + all replies',
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
    { op: 'set', path: ['foldedReplies'], value: 'all' },
  ])),
  '/narration display preset must write ui-chat',
)

// --- reset controls --------------------------------------------------------
const resetButtons = findNodes(
  container,
  (node) => node.type === 'button' && String(node.props?.title ?? '').endsWith('resetField'),
)
assert.ok(resetButtons.length >= 13, 'every editable field must offer a reset button')
await resetButtons[0].props.onClick()
assert.ok(
  calls.some(([k, ops]) => k === 'mutate' && JSON.stringify(ops) === JSON.stringify([
    { op: 'unset', path: ['enabled'] },
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
  calls.some(([k, ops]) => k === 'mutate' && Array.isArray(ops) && ops.length === 13 && ops.every((op) => op.op === 'unset')),
  'reset-all must unset all editable fields at once',
)
const pageResetButtons = findNodes(
  container,
  (node) => node.type === 'button' && String(node.children?.[0] ?? '').endsWith('resetPage'),
)
assert.ok(pageResetButtons.length >= 4, 'each tab page must offer its own reset button')
await pageResetButtons[0].props.onClick()
assert.ok(
  calls.some(([k, ops]) => k === 'mutate' && JSON.stringify(ops) === JSON.stringify([
    { op: 'unset', path: ['enabled'] },
    { op: 'unset', path: ['style'] },
    { op: 'unset', path: ['contract'] },
    { op: 'unset', path: ['maxSentences'] },
    { op: 'unset', path: ['minToolCalls'] },
    { op: 'unset', path: ['language'] },
  ])),
  'page reset must unset only that page fields',
)
await pageResetButtons[2].props.onClick()
assert.ok(
  calls.some(([k, ops]) => k === 'chat-mutate' && JSON.stringify(ops) === JSON.stringify([
    { op: 'set', path: ['transcriptView'], value: 'standard' },
    { op: 'set', path: ['collapseTiming'], value: 'completion' },
    { op: 'set', path: ['foldedReplies'], value: 'all' },
  ])),
  'display page reset must restore the ui-chat defaults',
)

console.log('client smoke: all assertions passed')
