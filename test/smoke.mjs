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
  buildPreview,
  analyzeAssistantMessage,
  analyzeUserMessage,
  createNarrationTracker,
  detectLanguage,
  resolveLanguage,
  DEFAULT_ENFORCE,
  DEFAULT_ESCALATE_AFTER,
  DEFAULT_CONTRACT,
  DEFAULT_ORDER,
  DEFAULT_MAX_SENTENCES,
  DEFAULT_MIN_TOOL_CALLS,
  DEFAULT_STYLE,
  DEFAULT_ANNOUNCE_PLAN,
  DEFAULT_REMINDER,
  DEFAULT_REMINDER_ORDER,
  MAX_TRACKED_SESSIONS,
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

// --- dynamic reminder (session events) ------------------------------------

test('analyzeAssistantMessage separates narration from tool calls', () => {
  assert.deepEqual(analyzeAssistantMessage({ content: [{ type: 'text', text: 'done' }] }), {
    hasText: true,
    toolCalls: 0,
  })
  assert.deepEqual(analyzeAssistantMessage({ content: [{ type: 'tool-call', id: 't1', name: 'read' }] }), {
    hasText: false,
    toolCalls: 1,
  })
  // Whitespace-only text is not narration.
  assert.deepEqual(analyzeAssistantMessage({ content: [{ type: 'text', text: '  ' }, { type: 'tool-call' }] }), {
    hasText: false,
    toolCalls: 1,
  })
  // Reasoning blocks are not narration (the user cannot see them).
  assert.deepEqual(analyzeAssistantMessage({ content: [{ type: 'reasoning', text: 'hmm' }] }), {
    hasText: false,
    toolCalls: 0,
  })
  assert.deepEqual(analyzeAssistantMessage(undefined), { hasText: false, toolCalls: 0 })
})

test('the tracker counts silent tool steps and resets on turn/start', () => {
  const tracker = createNarrationTracker()
  const session = { id: 's1' }
  assert.equal(tracker.keyOf(session), 's1')
  assert.equal(tracker.keyOf('s1'), 's1')
  assert.equal(tracker.keyOf(undefined), undefined)
  assert.equal(tracker.silentSteps(session), 0)

  tracker.observe(session, { type: 'turn/start', data: { turn: 1 } })
  tracker.observe(session, {
    type: 'assistant/message',
    data: { step: 1, message: { content: [{ type: 'tool-call', id: 'a' }] } },
  })
  assert.equal(tracker.silentSteps(session), 1)
  tracker.observe(session, {
    type: 'assistant/message',
    data: { step: 2, message: { content: [{ type: 'tool-call', id: 'b' }] } },
  })
  assert.equal(tracker.silentSteps(session), 2)

  // A narrated step clears the streak.
  tracker.observe(session, {
    type: 'assistant/message',
    data: { step: 3, message: { content: [{ type: 'text', text: 'found it' }, { type: 'tool-call', id: 'c' }] } },
  })
  assert.equal(tracker.silentSteps(session), 0)

  // A final answer (no tool calls) does not count at all.
  tracker.observe(session, {
    type: 'assistant/message',
    data: { step: 4, message: { content: [{ type: 'text', text: 'all done' }] } },
  })
  assert.equal(tracker.silentSteps(session), 0)
  assert.equal(tracker.silentSteps({ id: 'other' }), 0)
})

test('a silent tool step escalates the next reminder', () => {
  const { ctx, sections, listeners } = fakeCtx()
  apply(ctx, {})
  const reminder = sections.find((candidate) => candidate.name === REMINDER_SECTION_NAME)
  const onSessionEvent = listeners.get('session/event')
  assert.equal(typeof onSessionEvent, 'function', 'plugin must track session events')
  const session = { id: 's1' }

  // Nothing silent yet: base reminder.
  assert.doesNotMatch(reminder.text({ agent: { session } }), /注意：本轮出现过/)

  onSessionEvent(session, { type: 'turn/start', data: { turn: 1 } })
  onSessionEvent(session, {
    type: 'assistant/message',
    data: { step: 1, message: { content: [{ type: 'tool-call', id: 'a' }] } },
  })
  // The next model request sees the latched escalation line.
  assert.match(reminder.text({ agent: { session } }), /注意：本轮出现过/)

  // Further silent steps must not rewrite the reminder, so the prompt cache
  // stays reusable while the streak continues.
  const escalated = reminder.text({ agent: { session } })
  onSessionEvent(session, {
    type: 'assistant/message',
    data: { step: 2, message: { content: [{ type: 'tool-call', id: 'b' }, { type: 'reasoning', text: 'x' }] } },
  })
  assert.equal(
    reminder.text({ agent: { session } }),
    escalated,
    'the escalation text must stay identical while the streak continues',
  )

  // Speaking does not rewrite the reminder mid-turn: the line stays latched for
  // the rest of the turn so the prompt cache is not invalidated again.
  onSessionEvent(session, {
    type: 'assistant/message',
    data: { step: 3, message: { content: [{ type: 'text', text: 'read two files' }, { type: 'tool-call', id: 'c' }] } },
  })
  assert.equal(reminder.text({ agent: { session } }), escalated, 'a narrated step keeps the latched line')

  // The next turn starts clean once the model spoke during the previous one.
  onSessionEvent(session, {
    type: 'assistant/message',
    data: { step: 4, message: { content: [{ type: 'tool-call', id: 'd' }] } },
  })
  onSessionEvent(session, { type: 'turn/start', data: { turn: 2 } })
  assert.doesNotMatch(reminder.text({ agent: { session } }), /注意：本轮出现过/)
})

test('enforce: false and escalateAfter keep the reminder static', () => {
  const { ctx, sections, listeners } = fakeCtx()
  apply(ctx, { enforce: false })
  const reminder = sections.find((candidate) => candidate.name === REMINDER_SECTION_NAME)
  const emit = listeners.get('session/event')
  const session = { id: 's1' }
  emit(session, {
    type: 'assistant/message',
    data: { step: 1, message: { content: [{ type: 'tool-call', id: 'a' }] } },
  })
  assert.doesNotMatch(reminder.text({ agent: { session } }), /注意：本轮出现过/)

  const second = fakeCtx()
  apply(second.ctx, { escalateAfter: 2 })
  const harder = second.sections.find((candidate) => candidate.name === REMINDER_SECTION_NAME)
  const emit2 = second.listeners.get('session/event')
  emit2(session, {
    type: 'assistant/message',
    data: { step: 1, message: { content: [{ type: 'tool-call', id: 'a' }] } },
  })
  assert.doesNotMatch(harder.text({ agent: { session } }), /注意：本轮出现过/, 'threshold 2 tolerates one silent step')
  emit2(session, {
    type: 'assistant/message',
    data: { step: 2, message: { content: [{ type: 'tool-call', id: 'b' }] } },
  })
  assert.match(harder.text({ agent: { session } }), /注意：本轮出现过/)
})

test('the escalation line follows the reminder language and stays identical', () => {
  const en = resolveConfig({ language: 'en' })
  assert.doesNotMatch(buildReminderText(en, { silentSteps: 0 }), /called a tool without any narration/)
  const once = buildReminderText(en, { silentSteps: 1 })
  const twice = buildReminderText(en, { silentSteps: 2 })
  assert.match(once, /called a tool without any narration/)
  assert.equal(once, twice, 'the escalation must not change while the streak continues')
  assert.match(buildReminderText(resolveConfig({}), { silentSteps: 1 }), /注意：本轮出现过/)
})

test('a reminder text function with no session argument stays static', () => {
  const { ctx, sections } = fakeCtx()
  apply(ctx, {})
  const reminder = sections.find((candidate) => candidate.name === REMINDER_SECTION_NAME)
  assert.doesNotMatch(reminder.text(), /没有过程叙述/)
  assert.doesNotMatch(reminder.text({}), /没有过程叙述/)
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
    contract: DEFAULT_CONTRACT,
    maxSentences: DEFAULT_MAX_SENTENCES,
    minToolCalls: DEFAULT_MIN_TOOL_CALLS,
    language: 'auto',
    reportBlockers: true,
    ackSteering: true,
    announcePlan: DEFAULT_ANNOUNCE_PLAN,
    reminder: DEFAULT_REMINDER,
    enforce: DEFAULT_ENFORCE,
    escalateAfter: DEFAULT_ESCALATE_AFTER,
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
    [{ maxSentences: -1 }, /config\.maxSentences/],
    [{ maxSentences: 11 }, /config\.maxSentences/],
    [{ maxSentences: 2.5 }, /config\.maxSentences/],
    [{ minToolCalls: -1 }, /config\.minToolCalls/],
    [{ minToolCalls: 101 }, /config\.minToolCalls/],
    [{ minToolCalls: 1.5 }, /config\.minToolCalls/],
    [{ language: ' ' }, /config\.language/],
    [{ reportBlockers: 1 }, /config\.reportBlockers/],
    [{ ackSteering: 'no' }, /config\.ackSteering/],
    [{ announcePlan: 'yes' }, /config\.announcePlan/],
    [{ contract: 'fancy' }, /config\.contract/],
    [{ reminder: 'yes' }, /config\.reminder/],
    [{ enforce: 'on' }, /config\.enforce/],
    [{ escalateAfter: 0 }, /config\.escalateAfter/],
    [{ escalateAfter: 6 }, /config\.escalateAfter/],
    [{ escalateAfter: 1.5 }, /config\.escalateAfter/],
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

// --- v0.6.0: language, style-linked budget, bounded state -----------------

test('maxSentences 0 follows the style budget', () => {
  assert.equal(resolveConfig({}).maxSentences, 3, 'the default follows standard')
  assert.equal(resolveConfig({ style: 'concise', maxSentences: 0 }).maxSentences, 2)
  assert.equal(resolveConfig({ style: 'verbose', maxSentences: 0 }).maxSentences, 5)
  assert.equal(resolveConfig({ style: 'verbose', maxSentences: 2 }).maxSentences, 2, 'an explicit value wins')
  assert.match(buildSectionText(resolveConfig({ style: 'verbose', maxSentences: 0 })), /1–5 句/)
})

test('the compact contract keeps every rule in fewer characters', () => {
  const full = buildSectionText(resolveConfig({ contract: 'full' }))
  const compact = buildSectionText(resolveConfig({ contract: 'compact' }))
  assert.ok(
    compact.length < full.length * 0.6,
    `compact (${compact.length}) should be much shorter than full (${full.length})`,
  )
  assert.match(compact, /## 过程叙述/)
  assert.match(compact, /硬性要求/)
  assert.match(compact, /开场/)
  assert.match(compact, /1–3 句/)
  const compactEn = buildSectionText(resolveConfig({ contract: 'compact', language: 'en' }))
  assert.match(compactEn, /## Interim narration/)
  assert.match(compactEn, /Hard requirement/)
})

test('buildPreview reports both texts and a size estimate', () => {
  const config = resolveConfig({})
  const preview = buildPreview(config)
  assert.equal(preview.text, buildSectionText(config))
  assert.equal(preview.chars, preview.text.length)
  assert.equal(preview.reminder, buildReminderText(config))
  assert.equal(preview.reminderChars, preview.reminder.length)
  assert.ok(preview.approxTokens > 0)
  const compact = buildPreview(resolveConfig({ contract: 'compact' }))
  assert.ok(compact.approxTokens < preview.approxTokens, 'compact should estimate fewer tokens')
})

test('language detection follows the user text', () => {
  assert.equal(detectLanguage('请帮我检查一下这个文件的改动'), 'zh')
  assert.equal(detectLanguage('Please review the changes and summarize them for me'), 'en')
  assert.equal(detectLanguage('ok'), undefined)
  assert.equal(detectLanguage(''), undefined)
  assert.equal(detectLanguage(undefined), undefined)
  assert.equal(analyzeUserMessage({ role: 'user', content: [{ type: 'text', text: ' hello ' }] }), 'hello')
  assert.equal(analyzeUserMessage(' plain '), 'plain')
  assert.equal(analyzeUserMessage({ content: [{ type: 'tool-result', text: 'x' }] }), '')
  assert.equal(resolveLanguage(resolveConfig({ language: 'en' }), 'zh'), 'en')
  assert.equal(resolveLanguage(resolveConfig({ language: 'zh' }), 'en'), 'zh')
  assert.equal(resolveLanguage(resolveConfig({ language: 'auto' }), 'en'), 'en')
  assert.equal(resolveLanguage(resolveConfig({ language: 'auto' }), undefined), 'zh')
})

test('language: auto follows the session user messages', () => {
  const { ctx, sections, listeners } = fakeCtx()
  apply(ctx, { language: 'auto' })
  const section = sections.find((candidate) => candidate.name === SECTION_NAME)
  const reminder = sections.find((candidate) => candidate.name === REMINDER_SECTION_NAME)
  const emit = listeners.get('session/event')
  const session = { id: 'lang-1' }
  assert.match(section.text({ agent: { session } }), /## 过程叙述/)

  emit(session, {
    type: 'user/message',
    data: {
      message: { role: 'user', content: [{ type: 'text', text: 'Please explain what you are doing in English.' }] },
    },
  })
  assert.match(section.text({ agent: { session } }), /## Interim narration/)
  assert.match(reminder.text({ agent: { session } }), /## Narration reminder/)

  // The language is latched for the rest of the turn: a second user message with
  // another language must not rewrite the system prompt mid-turn (cache safety).
  emit(session, {
    type: 'user/message',
    data: { message: { role: 'user', content: [{ type: 'text', text: '继续用中文说明' }] } },
  })
  assert.match(section.text({ agent: { session } }), /## Interim narration/)

  // The next turn may re-latch to Chinese.
  emit(session, { type: 'turn/start', data: { turn: 2 } })
  emit(session, {
    type: 'user/message',
    data: { message: { role: 'user', content: [{ type: 'text', text: '继续用中文说明' }] } },
  })
  assert.match(section.text({ agent: { session } }), /## 过程叙述/)
})

test('the tracker remembers the user language across turns', () => {
  const tracker = createNarrationTracker()
  const session = { id: 's-lang' }
  tracker.observe(session, {
    type: 'user/message',
    data: { message: { role: 'user', content: [{ type: 'text', text: 'Use English please, thanks a lot.' }] } },
  })
  assert.equal(tracker.language(session), 'en')
  tracker.observe(session, { type: 'turn/start', data: { turn: 2 } })
  assert.equal(tracker.language(session), 'en', 'a new turn keeps the language')
  tracker.observe(session, {
    type: 'user/message',
    data: { message: { role: 'user', content: [{ type: 'text', text: '现在请用中文继续说' }] } },
  })
  assert.equal(tracker.language(session), 'zh')
  assert.equal(tracker.language({ id: 'unknown' }), undefined)
})

test('tracker state stays bounded across many sessions', () => {
  const tracker = createNarrationTracker()
  for (let index = 0; index <= MAX_TRACKED_SESSIONS + 9; index += 1) {
    tracker.observe({ id: `session-${index}` }, { type: 'turn/start', data: { turn: 1 } })
  }
  assert.equal(tracker.state({ id: 'session-0' }).turn, 0, 'the oldest state was evicted')
  assert.equal(tracker.state({ id: `session-${MAX_TRACKED_SESSIONS + 9}` }).turn, 1)
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
    assert.match(content, /reminder=true enforce=true escalateAfter=1 sectionChars=\d+ reminderChars=\d+/)
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
