// Smoke tests for dsh-interim-narration: plugin shape, config validation, the
// prompt section it registers, live settings updates through volatile
// references, and debug-log behavior.
//
// Everything is exercised through lib/core.js, which imports only Node
// builtins: the host-only schemastery `Config` schema is covered by the mock-LLM
// end-to-end run in test/overlay-mock.example.yml.
//
// Run with: node test/smoke.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  apply,
  inject,
  name,
  resolveConfig,
  plainValues,
  buildSectionText,
  DEFAULT_ORDER,
  DEFAULT_MAX_SENTENCES,
  DEFAULT_MIN_TOOL_CALLS,
  DEFAULT_STYLE,
  DEFAULT_ANNOUNCE_PLAN,
  DEFAULT_REMINDER,
  DEFAULT_REMINDER_ORDER,
  REMINDER_SECTION_NAME,
  STYLES,
  SECTION_NAME,
  buildReminderText,
} from '../lib/core.js'

/** Minimal stand-in for a Cordis plugin context with a prompt registry. */
function fakeCtx({ withEvents = true } = {}) {
  const sections = []
  const effectLabels = []
  const listeners = new Map()
  const ctx = {
    systemPrompt: {
      section(spec) {
        sections.push(spec)
        return () => {}
      },
    },
    effect(fn, label) {
      effectLabels.push(label)
      return fn()
    },
  }
  if (withEvents) {
    ctx.on = (event, listener) => {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    }
  }
  return { ctx, sections, effectLabels, listeners }
}

/** Mount with a config and return the main registered section. */
function mount(config, options) {
  const { ctx, sections } = fakeCtx(options)
  apply(ctx, config)
  assert.equal(sections.length, 2, 'expected the main section and the reminder')
  const section = sections.find((candidate) => candidate.name === SECTION_NAME)
  assert.ok(section, 'the main section must be registered')
  return section
}

/** Mount and render the section body as the prompt registry would. */
function render(config, options) {
  const section = mount(config, options)
  assert.equal(typeof section.text, 'function', 'section text must be a lazy function')
  return section.text()
}

/** A volatile reference, as the loader hands it to `apply`. */
function ref(read) {
  return { get: read }
}

const tests = []
function test(title, fn) {
  tests.push({ title, fn })
}

// --- plugin shape ---------------------------------------------------------

test('plugin exports the Cordis shape', () => {
  assert.equal(name, 'interim-narration')
  assert.deepEqual(inject, ['systemPrompt'])
  assert.equal(typeof apply, 'function')
  assert.deepEqual(STYLES, ['concise', 'standard', 'verbose'])
})

test('registers the main section and a reminder with the documented defaults', () => {
  const { ctx, sections, effectLabels } = fakeCtx()
  apply(ctx, {})
  assert.equal(sections.length, 2)
  assert.ok(effectLabels.includes('interim-narration.section()'))
  assert.ok(effectLabels.includes('interim-narration.reminder()'))
  assert.ok(effectLabels.includes('interim-narration.volatile-log'))
  const section = sections.find((candidate) => candidate.name === SECTION_NAME)
  assert.equal(section.name, SECTION_NAME)
  assert.equal(section.order, DEFAULT_ORDER)
  assert.equal(section.interpolate, false)

  const text = section.text()
  assert.match(text, /## 过程叙述/)
  assert.match(text, new RegExp(`1–${DEFAULT_MAX_SENTENCES} 句`))
  assert.match(text, new RegExp(`不超过 ${DEFAULT_MIN_TOOL_CALLS} 次工具调用`))
  assert.match(text, /不要写进思考/)
  assert.match(text, /最终回答/)
  // 0.3.1: the turn must open with the model's understanding and plan.
  assert.match(text, /调用任何工具之前/)
  assert.match(text, /第一步是什么/)
  // The contract must also forbid silent tool chains outright.
  assert.match(text, /硬性要求/)
  assert.match(text, /不允许「工具调用 → 工具调用」全程静默/)
  // A mistake in the template must never leak JS values into the prompt.
  assert.doesNotMatch(text, /\bundefined\b|\bnull\b|\[object Object\]/)
})

// --- live settings updates (volatile references) --------------------------

test('the section body is read lazily from volatile references', () => {
  let style = 'concise'
  let enabled = true
  const section = mount({
    enabled: ref(() => enabled),
    style: ref(() => style),
    maxSentences: ref(() => 4),
  })

  assert.match(section.text(), /1–4 句/)
  assert.match(section.text(), /更简/)

  style = 'verbose'
  assert.match(section.text(), /更详/, 'a style saved in place must change the next render')

  enabled = false
  assert.equal(section.text(), '', 'disabled contributes an empty prompt section')
  enabled = true
  assert.match(section.text(), /## 过程叙述/)
})

test('enabled: false keeps both sections registered (empty bodies)', () => {
  const { ctx, sections } = fakeCtx()
  apply(ctx, { enabled: false })
  assert.equal(sections.length, 2)
  for (const section of sections) assert.equal(section.text(), '')
})

test('plainValues unwraps volatile references and copies plain fields', () => {
  assert.deepEqual(plainValues(undefined), {})
  assert.deepEqual(plainValues(null), {})
  assert.deepEqual(plainValues([1, 2]), {})
  assert.deepEqual(plainValues({ style: ref(() => 'verbose'), order: 9000, extra: undefined }), {
    style: 'verbose',
    order: 9000,
    extra: undefined,
  })
  // A throwing reference must not break config reading; it acts like an unset field.
  assert.deepEqual(plainValues({ style: { get: () => { throw new Error('boom') } } }), { style: undefined })
})

// --- style presets --------------------------------------------------------

test('style presets pick their sentence budgets', () => {
  assert.equal(resolveConfig({ style: 'concise' }).maxSentences, 2)
  assert.equal(resolveConfig({ style: 'verbose' }).maxSentences, 5)
  assert.equal(resolveConfig({ style: DEFAULT_STYLE }).maxSentences, DEFAULT_MAX_SENTENCES)
})

test('an explicit maxSentences overrides the style budget', () => {
  assert.equal(resolveConfig({ style: 'verbose', maxSentences: 1 }).maxSentences, 1)
  assert.match(render({ style: 'verbose', maxSentences: 2 }), /1–2 句/)
})

test('style changes the guidance line', () => {
  assert.match(render({ style: 'concise' }), /更简/)
  assert.match(render({ style: 'verbose' }), /更详/)
  assert.match(render({ style: 'standard' }), /详略/)
})

// --- toggles --------------------------------------------------------------

test('minToolCalls changes the "simple task" threshold', () => {
  assert.match(render({ minToolCalls: 0 }), /不超过 0 次工具调用/)
  assert.match(render({ minToolCalls: 7 }), /不超过 7 次工具调用/)
  assert.doesNotMatch(buildSectionText(resolveConfig({ minToolCalls: 7 })), /不超过 2 次/)
})

test('reportBlockers and ackSteering can be turned off', () => {
  const on = render({})
  assert.match(on, /失败、受阻或计划变更/)
  assert.match(on, /用户中途插话/)

  const off = render({ reportBlockers: false, ackSteering: false })
  assert.doesNotMatch(off, /失败、受阻或计划变更/)
  assert.doesNotMatch(off, /用户中途插话/)
  // Turning the optional lines off must not damage the rest of the contract.
  assert.match(off, /## 过程叙述/)
  assert.match(off, /最终回答/)
})

test('announcePlan opens the turn with understanding and plan', () => {
  const text = render({})
  assert.match(text, /调用任何工具之前，先用 1–2 句正文开场/)
  assert.match(text, /不要只复述用户的话/)
  assert.match(text, /第一步是什么/)
})

test('the opening survives the simple-task shortcut', () => {
  // The user asked for the opening on every turn, so `minToolCalls` may only
  // waive the middle notes.
  const text = render({ minToolCalls: 10 })
  assert.match(text, /不超过 10 次工具调用.*省略中间叙述，但开场仍要保留/)
  assert.match(text, /调用任何工具之前，先用 1–2 句正文开场/)
})

test('announcePlan: false drops only the opening lines', () => {
  const off = render({ announcePlan: false })
  assert.doesNotMatch(off, /调用任何工具之前，先用 1–2 句正文开场/)
  assert.doesNotMatch(off, /不要只复述用户的话/)
  // Without the opening, the simple-task shortcut goes back to "no narration".
  assert.match(off, /直接给最终回答，不必叙述/)
  // The rest of the contract stays intact, without double blank lines.
  assert.match(off, /## 过程叙述/)
  assert.match(off, /每批工具调用结束后/)
  assert.doesNotMatch(off, /\n\n\n/)
  assert.ok(off.trim().length > 200)
})

test('a short reminder sits near the end of the system prompt', () => {
  const { ctx, sections } = fakeCtx()
  apply(ctx, {})
  const reminder = sections.find((candidate) => candidate.name === REMINDER_SECTION_NAME)
  assert.ok(reminder, 'reminder section must be registered')
  assert.equal(reminder.order, DEFAULT_REMINDER_ORDER)
  assert.ok(reminder.order > DEFAULT_ORDER, 'the reminder must come after the main contract')
  assert.equal(reminder.interpolate, false)
  const text = reminder.text()
  assert.match(text, /## 过程叙述提醒/)
  assert.match(text, /调用第一个工具之前/)
  assert.match(text, /不要整轮只调工具、不说话/)
})

test('the reminder follows announcePlan, language and its own toggle', () => {
  assert.match(buildReminderText(resolveConfig({ announcePlan: false })), /先写一句正文说明你准备做什么/)
  assert.doesNotMatch(buildReminderText(resolveConfig({ announcePlan: false })), /第一步是什么/)
  assert.match(buildReminderText(resolveConfig({ language: 'en' })), /## Narration reminder/)
  assert.match(buildReminderText(resolveConfig({ language: 'en' })), /never run a whole turn of tool calls in silence/)

  const { ctx, sections } = fakeCtx()
  apply(ctx, { reminder: false })
  const reminder = sections.find((candidate) => candidate.name === REMINDER_SECTION_NAME)
  assert.equal(reminder.text(), '', 'reminder: false must empty the second section')
})

test('the English contract also forbids silent tool chains', () => {
  assert.match(render({ language: 'en' }), /Hard requirement/)
  assert.match(render({ language: 'en' }), /never chain tool calls in complete silence/)
})

test('the English contract also opens with the plan', () => {
  assert.match(render({ language: 'en' }), /Right after the new message, before calling any tool/)
  assert.doesNotMatch(
    render({ language: 'en', announcePlan: false }),
    /Right after the new message, before calling any tool/,
  )
})

// --- language / overrides -------------------------------------------------

test('language: en and order are applied', () => {
  const section = mount({ language: 'en', order: 1234 })
  assert.equal(section.order, 1234)
  const text = section.text()
  assert.match(text, /## Interim narration/)
  assert.match(text, /1–3 sentences/)
  assert.match(text, /never inside reasoning/)
})

test('text overrides the built-in wording, extra is appended', () => {
  assert.equal(render({ text: 'Always narrate.', extra: 'Extra rule.' }), 'Always narrate.\nExtra rule.\n')
})

test('an empty text field still uses the built-in wording', () => {
  // The host schema defaults `text` to ''; that must not blank the section.
  assert.match(render({ text: '' }), /## 过程叙述/)
  assert.match(render({ text: '   ' }), /## 过程叙述/)
})

test('extra is appended to the built-in wording too', () => {
  const text = render({ extra: '自定义要求。' })
  assert.match(text, /## 过程叙述/)
  assert.ok(text.trimEnd().endsWith('自定义要求。'))
})

// --- config validation ----------------------------------------------------

test('resolveConfig fills defaults', () => {
  assert.deepEqual(resolveConfig(undefined), {
    enabled: true,
    order: DEFAULT_ORDER,
    style: DEFAULT_STYLE,
    maxSentences: DEFAULT_MAX_SENTENCES,
    minToolCalls: DEFAULT_MIN_TOOL_CALLS,
    language: 'auto',
    reportBlockers: true,
    ackSteering: true,
    announcePlan: DEFAULT_ANNOUNCE_PLAN,
    reminder: DEFAULT_REMINDER,
    text: undefined,
    extra: undefined,
    debug: false,
    logFile: undefined,
  })
})

test('resolveConfig rejects bad values', () => {
  const bad = [
    [[], /config must be a mapping\/object/],
    [{ enabled: 'yes' }, /config\.enabled/],
    [{ order: Number.NaN }, /config\.order/],
    [{ order: Infinity }, /config\.order/],
    [{ style: 'fancy' }, /config\.style/],
    [{ maxSentences: 0 }, /config\.maxSentences/],
    [{ maxSentences: 11 }, /config\.maxSentences/],
    [{ maxSentences: 2.5 }, /config\.maxSentences/],
    [{ minToolCalls: -1 }, /config\.minToolCalls/],
    [{ minToolCalls: 101 }, /config\.minToolCalls/],
    [{ minToolCalls: 1.5 }, /config\.minToolCalls/],
    [{ language: ' ' }, /config\.language/],
    [{ reportBlockers: 1 }, /config\.reportBlockers/],
    [{ ackSteering: 'no' }, /config\.ackSteering/],
    [{ announcePlan: 'yes' }, /config\.announcePlan/],
    [{ reminder: 'yes' }, /config\.reminder/],
    [{ text: 1 }, /config\.text/],
    [{ extra: false }, /config\.extra/],
    [{ debug: 'on' }, /config\.debug/],
    [{ logFile: 3 }, /config\.logFile/],
  ]
  for (const [config, pattern] of bad) {
    assert.throws(() => resolveConfig(config), pattern, JSON.stringify(config))
  }
})

test('buildSectionText never returns an empty contract', () => {
  for (const style of STYLES) {
    const text = buildSectionText(resolveConfig({ style }))
    assert.ok(text.trim().length > 200, `${style} section is too short`)
    assert.ok(text.endsWith('\n'))
    assert.doesNotMatch(text, /\n\n\n/)
  }
})

// --- debug logging --------------------------------------------------------

test('debug log records the mount and rotates oversized files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interim-narration-'))
  const logFile = path.join(dir, 'debug.log')
  try {
    // Pre-fill beyond the 64 KiB cap to exercise rotation.
    fs.writeFileSync(logFile, 'x'.repeat(70 * 1024))
    const { ctx } = fakeCtx()
    apply(ctx, { debug: true, logFile, style: 'concise', minToolCalls: 1 })
    const content = fs.readFileSync(logFile, 'utf8')
    assert.ok(content.length < 70 * 1024, 'log should have been rotated before writing')
    assert.match(content, /mounted order=8950 style=concise maxSentences=2 minToolCalls=1/)
    assert.match(content, /reminder=true sectionChars=\d+ reminderChars=\d+/)
    assert.match(content, /--- section text ---/)
    assert.match(content, /--- reminder text ---/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('live settings edits leave a debug line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interim-narration-'))
  const logFile = path.join(dir, 'debug.log')
  try {
    const { ctx, listeners } = fakeCtx()
    apply(ctx, { debug: true, logFile })
    const emit = listeners.get('loader/volatile-update')
    assert.equal(typeof emit, 'function', 'plugin should listen for loader/volatile-update')
    emit(['style', 'maxSentences'])
    const content = fs.readFileSync(logFile, 'utf8')
    assert.match(content, /volatile-update paths=\["style","maxSentences"\]/)
    assert.match(content, /style=standard/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a broken log path never breaks mounting', () => {
  const { ctx, sections } = fakeCtx()
  apply(ctx, { debug: true, logFile: path.join(os.tmpdir(), 'no-such-dir-xyz', 'a.log') })
  assert.equal(sections.length, 2)
})

// --- runner ---------------------------------------------------------------

let failed = 0
for (const { title, fn } of tests) {
  try {
    fn()
    console.log(`ok   - ${title}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL - ${title}`)
    console.error(error)
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`)
if (failed > 0) process.exitCode = 1
