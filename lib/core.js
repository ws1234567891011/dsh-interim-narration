/**
 * dsh-interim-narration — pure prompt/config/wiring logic.
 *
 * Everything that does not need a DSH-specific module lives here: the prompt
 * text, config validation, volatile-reference unwrapping, the debug log, and the
 * Cordis `apply` function. The host half (./index.js) only adds the schemastery
 * `Config` schema on top of this module, so the smoke tests can import this file
 * with plain Node (no `@deepseek-ai/*` resolution required).
 *
 * @module dsh-interim-narration/core
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Package name used in diagnostics. */
export const PLUGIN = 'dsh-interim-narration'

/** Section name in the prompt registry (stable id, not user-visible). */
export const SECTION_NAME = 'narration:interim'

/** Default section order: after the tool documentation, before deliverable guidance. */
export const DEFAULT_ORDER = 8950

/** How long a narration note may get: sentence budget per `style`. */
export const STYLES = ['concise', 'standard', 'verbose']

/** Default sentence budgets for each style. */
export const STYLE_SENTENCES = { concise: 2, standard: 3, verbose: 5 }

/** Default `style`. */
export const DEFAULT_STYLE = 'standard'

/** Default `maxSentences` (the `standard` budget). */
export const DEFAULT_MAX_SENTENCES = STYLE_SENTENCES[DEFAULT_STYLE]

/** Default minimum number of tool calls in a batch worth a separate note. */
export const DEFAULT_MIN_TOOL_CALLS = 2

/** Default for the "say your understanding and plan before the first tool call" rule. */
export const DEFAULT_ANNOUNCE_PLAN = true

/**
 * Name of the short reminder section.
 *
 * Long turns drift: the main contract sits after the tool documentation and is
 * easy to forget once a chain of tool calls starts. The reminder is a second,
 * much shorter section registered near the end of the system prompt (right
 * before the deployment persona suffix) so the rule is the last thing the model
 * reads.
 */
export const REMINDER_SECTION_NAME = 'narration:interim-reminder'

/** Order of the reminder section: after everything else, before the persona suffix. */
export const DEFAULT_REMINDER_ORDER = 10150

/** Default for the reminder toggle. */
export const DEFAULT_REMINDER = true

/**
 * Default for the mechanism-level enforcement toggle.
 *
 * The prompt can only ask; it cannot see what happened. With `enforce` on, the
 * plugin watches the session events and makes the reminder escalate after a tool
 * step that carried no narration — so a drifting turn gets a sharper note before
 * the next model call instead of only a static rule.
 */
export const DEFAULT_ENFORCE = true

/** Default number of consecutive silent tool steps before the reminder escalates. */
export const DEFAULT_ESCALATE_AFTER = 1

/** Build the Chinese (default) instruction text. */
export function zhText(opts) {
  const max = opts.maxSentences
  const min = opts.minToolCalls
  const styleLine =
    opts.style === 'concise'
      ? '- 更简：只讲结论和下一步，不展开原因，能一句说完就一句。'
      : opts.style === 'verbose'
        ? '- 更详：补充关键依据、数字和风险判断，让用户不用翻工具行也能跟上判断。'
        : '- 详略：先给结论，再给必要依据；宁可短，不要长。'
  const blockerLine = opts.reportBlockers
    ? '- 失败、受阻或计划变更：先说事实和影响，再说怎么调整；不要沉默执行，也不要编造成功。'
    : ''
  const steeringLine = opts.ackSteering ? '- 用户中途插话：先用一句话回应他的问题或要求，再继续当前工作。' : ''
  const openingLine = opts.announcePlan
    ? '- 收到新消息后、调用任何工具之前，先用 1–2 句正文开场：你怎么理解这条消息、你准备怎么做、第一步是什么。'
    : ''
  const openingHint = opts.announcePlan
    ? '- 开场段落要给出判断和计划（做什么、为什么这么做、先做哪一步），不要只复述用户的话。'
    : ''
  // The opening is the one part the user asked to see on every turn, so a
  // simple task may drop the middle notes but not the opening.
  const simpleTaskLine = opts.announcePlan
    ? `- 简单任务（不超过 ${min} 次工具调用）可以省略中间叙述，但开场仍要保留。`
    : `- 简单任务（不超过 ${min} 次工具调用）可以直接给最终回答，不必叙述。`

  return `## 过程叙述（边做边说）

用户只能看到零散的工具行（「读取了文件」「运行了命令」），看不到你的工作状态和判断。请在过程里主动说明，让用户随时跟得上：

### 什么时候说
${openingLine ? `${openingLine}\n` : ''}- 每批工具调用结束后、开始下一批之前，写一段普通正文（1–${max} 句）。
- 硬性要求：只要这一轮调用了工具，就必须至少写一段过程叙述正文；不允许「工具调用 → 工具调用」全程静默。开场段和批次间的段落都算。
- 一批里只有一两次轻量调用（例如读一个文件）时，可以并入下一段，不必每步都说。
- 执行耗时较长的命令、等待长时间任务、或准备批量修改之前，先说一句要做什么。
${simpleTaskLine}

### 说什么
${openingHint ? `${openingHint}\n` : ''}- 刚完成什么、得出什么结论（关键数字、文件名、判定）；接下来做什么、为什么这样做。
- 只写新增信息；不要复述计划、不要复读工具输出、不要重复上一段说过的内容。
- 避免空话（「好的，我继续」「现在处理下一部分」这类没有信息量的句子不要单独成段）。
${styleLine}
${blockerLine}
${steeringLine}
- 委派子代理/并行任务：说明委派了什么、你自己同时做什么、什么时候汇总。

### 怎么写
- 普通段落，不使用标题、列表、加粗、代码块；每段开头直接给结论或动作。
- 用与用户相同的语言；写在正常回复正文里，不要写进思考（reasoning）内容。
- 过程叙述是给用户看的过程说明，不是最终答案：任务完成后照常输出完整、独立的最终回答。
`.replace(/\n{3,}/g, '\n\n')
}

/** Build the English instruction text. */
export function enText(opts) {
  const max = opts.maxSentences
  const min = opts.minToolCalls
  const styleLine =
    opts.style === 'concise'
      ? '- Be brief: conclusion and next step only, one sentence when possible.'
      : opts.style === 'verbose'
        ? '- Be thorough: add the key evidence, numbers, and risk judgment so the user can follow without reading the tool rows.'
        : '- Prefer the conclusion first, then only the evidence that is needed.'
  const blockerLine = opts.reportBlockers
    ? '- Failures, blockers, or plan changes: state the fact and impact first, then how you adapt. Do not go silent, and never claim success you did not get.'
    : ''
  const steeringLine = opts.ackSteering
    ? '- When the user interjects: answer their point in one sentence, then continue the work.'
    : ''
  const openingLine = opts.announcePlan
    ? '- Right after the new message, before calling any tool, open with 1–2 sentences: how you understand the message, what you are going to do, and the first step.'
    : ''
  const openingHint = opts.announcePlan
    ? '- The opening note should carry your judgment and plan (what, why, which step first), not a restatement of the user message.'
    : ''
  // The opening survives the simple-task shortcut: it is what the user asked to
  // see on every turn.
  const simpleTaskLine = opts.announcePlan
    ? `- Simple tasks (${min} tool calls or fewer) may skip the middle notes, but keep the opening.`
    : `- Simple tasks (${min} tool calls or fewer) may go straight to the final answer without narration.`

  return `## Interim narration (narrate while you work)

The user only sees scattered tool rows ("read a file", "ran a command"), not your working state or judgment. Narrate in ordinary reply text so the user can follow:

### When to narrate
${openingLine ? `${openingLine}\n` : ''}- After each batch of tool calls and before the next one, write 1–${max} sentences of plain assistant text.
- Hard requirement: if this turn calls any tool, it must contain at least one paragraph of narration; never chain tool calls in complete silence. The opening note and the notes between batches both count.
- If a batch only makes one or two light calls (for example reading a single file), fold them into the next note instead of narrating every step.
- Before a long-running command, a long wait, or a batch edit, say what you are about to do.
${simpleTaskLine}

### What to say
${openingHint ? `${openingHint}\n` : ''}- What you just finished and concluded (key numbers, file names, verdicts); what comes next and why.
- Only new information: do not restate the plan, re-read tool output, or repeat the previous note.
- Avoid filler ("Okay, continuing", "Now the next part"): it carries no information.
${styleLine}
${blockerLine}
${steeringLine}
- Subagents/parallel work: say what you delegated, what you do meanwhile, and when you will merge results.

### How to write it
- Plain paragraphs: no headings, lists, bold, or code blocks; open each paragraph with the conclusion or the action.
- Use the same language as the user; put it in ordinary reply text, never inside reasoning.
- Narration is a progress note, not the final answer: finish with a complete, standalone answer.
`.replace(/\n{3,}/g, '\n\n')
}

/** Short Chinese reminder registered near the end of the system prompt. */
export function zhReminder(opts) {
  const opening = opts.announcePlan
    ? '调用第一个工具之前，先用 1–2 句正文说明：你怎么理解这条消息、准备怎么做、第一步是什么。'
    : '调用第一个工具之前，先写一句正文说明你准备做什么。'
  return `## 过程叙述提醒

${opening}之后每批工具调用之间，用 1–2 句正文说明刚完成什么、接下来做什么。这些正文写在正常回复里，用户会直接看到；不要整轮只调工具、不说话。
`
}

/** Short English reminder registered near the end of the system prompt. */
export function enReminder(opts) {
  const opening = opts.announcePlan
    ? 'Before the first tool call, open with 1–2 sentences: how you read the message, what you will do, and the first step.'
    : 'Before the first tool call, open with one sentence about what you are about to do.'
  return `## Narration reminder

${opening} Between tool-call batches, add 1–2 sentences about what just finished and what comes next. Write them as ordinary reply text — the user sees them directly; never run a whole turn of tool calls in silence.
`
}

/**
 * Extra Chinese line appended to the reminder after silent tool steps.
 *
 * Two levels are enough: the first catches the ordinary "forgot to speak" case,
 * the second (two or more silent steps in a row) is deliberately blunt.
 */
export function zhEscalation(silentSteps) {
  if (silentSteps <= 1) {
    return '- 注意：你上一步没有写过程叙述就调用了工具。本步在调用工具之前，先用 1–2 句正文说明你刚做了什么、接下来做什么。'
  }
  return `- 再次提醒：你已经连续 ${silentSteps} 步没有过程叙述。本步必须先用正文说明当前判断，再调用工具；用户看不到你的思考，只能靠这些正文。`
}

/** Extra English line appended to the reminder after silent tool steps. */
export function enEscalation(silentSteps) {
  if (silentSteps <= 1) {
    return '- Note: the previous step called a tool without any narration. Before the next tool call, write 1–2 sentences about what you just did and what comes next.'
  }
  return `- Reminder: ${silentSteps} consecutive steps carried no narration. Start this step with the current judgment in plain reply text before calling any tool; the user cannot see your reasoning otherwise.`
}

/**
 * The exact reminder text for the resolved config.
 *
 * @param config - resolved config.
 * @param options - `{ silentSteps }` from the session tracker; when
 *   `enforce` is on and the count reaches `escalateAfter`, one escalation line
 *   is appended. The static call (no options) returns the base reminder.
 */
export function buildReminderText(config, options = {}) {
  const useEnglish = /^en\b/i.test(config.language.trim())
  const opts = { announcePlan: config.announcePlan }
  const base = useEnglish ? enReminder(opts) : zhReminder(opts)
  const silentSteps = Number.isFinite(options.silentSteps) ? options.silentSteps : 0
  if (!config.enforce || silentSteps < config.escalateAfter) return base
  const escalation = useEnglish ? enEscalation(silentSteps) : zhEscalation(silentSteps)
  return `${base.trimEnd()}\n${escalation}\n`
}

/** Read the whole raw config as a plain object, rejecting non-objects. */
function asConfigObject(raw) {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${PLUGIN}: config must be a mapping/object`)
  }
  return raw
}

function fail(field, expectation, value) {
  throw new Error(`${PLUGIN}: config.${field} must be ${expectation} (got ${JSON.stringify(value)})`)
}

/**
 * Validate the plugin config from the bundle patch / profile patch.
 * Every field is optional; unknown fields are ignored on purpose so a newer
 * patch does not break an older install.
 *
 * @param raw - the raw `config` value the loader passed to `apply`, or a plain
 *   object read back from the volatile configuration references.
 */
export function resolveConfig(raw) {
  const c = asConfigObject(raw)

  const enabled = c.enabled === undefined ? true : c.enabled
  if (typeof enabled !== 'boolean') fail('enabled', 'a boolean', c.enabled)

  const order = c.order === undefined ? DEFAULT_ORDER : c.order
  if (typeof order !== 'number' || !Number.isFinite(order)) fail('order', 'a finite number', c.order)

  const style = c.style === undefined ? DEFAULT_STYLE : c.style
  if (!STYLES.includes(style)) fail('style', `one of ${STYLES.join(' | ')}`, c.style)

  const maxSentences = c.maxSentences === undefined ? STYLE_SENTENCES[style] : c.maxSentences
  if (!Number.isInteger(maxSentences) || maxSentences < 1 || maxSentences > 10) {
    fail('maxSentences', 'an integer between 1 and 10', c.maxSentences)
  }

  const minToolCalls = c.minToolCalls === undefined ? DEFAULT_MIN_TOOL_CALLS : c.minToolCalls
  if (!Number.isInteger(minToolCalls) || minToolCalls < 0 || minToolCalls > 100) {
    fail('minToolCalls', 'an integer between 0 and 100', c.minToolCalls)
  }

  const language = c.language === undefined ? 'auto' : c.language
  if (typeof language !== 'string' || language.trim() === '') fail('language', 'a non-empty string', c.language)

  const reportBlockers = c.reportBlockers === undefined ? true : c.reportBlockers
  if (typeof reportBlockers !== 'boolean') fail('reportBlockers', 'a boolean', c.reportBlockers)

  const ackSteering = c.ackSteering === undefined ? true : c.ackSteering
  if (typeof ackSteering !== 'boolean') fail('ackSteering', 'a boolean', c.ackSteering)

  const announcePlan = c.announcePlan === undefined ? DEFAULT_ANNOUNCE_PLAN : c.announcePlan
  if (typeof announcePlan !== 'boolean') fail('announcePlan', 'a boolean', c.announcePlan)

  const reminder = c.reminder === undefined ? DEFAULT_REMINDER : c.reminder
  if (typeof reminder !== 'boolean') fail('reminder', 'a boolean', c.reminder)

  const enforce = c.enforce === undefined ? DEFAULT_ENFORCE : c.enforce
  if (typeof enforce !== 'boolean') fail('enforce', 'a boolean', c.enforce)

  const escalateAfter = c.escalateAfter === undefined ? DEFAULT_ESCALATE_AFTER : c.escalateAfter
  if (!Number.isInteger(escalateAfter) || escalateAfter < 1 || escalateAfter > 5) {
    fail('escalateAfter', 'an integer between 1 and 5', c.escalateAfter)
  }

  if (c.text !== undefined && typeof c.text !== 'string') fail('text', 'a string', c.text)
  if (c.extra !== undefined && typeof c.extra !== 'string') fail('extra', 'a string', c.extra)

  const debug = c.debug === undefined ? false : c.debug
  if (typeof debug !== 'boolean') fail('debug', 'a boolean', c.debug)

  if (c.logFile !== undefined && typeof c.logFile !== 'string') fail('logFile', 'a string', c.logFile)

  return {
    enabled,
    order,
    style,
    maxSentences,
    minToolCalls,
    language,
    reportBlockers,
    ackSteering,
    announcePlan,
    reminder,
    enforce,
    escalateAfter,
    text: c.text,
    extra: c.extra,
    debug,
    logFile: c.logFile,
  }
}

/**
 * The exact text registered as the prompt section.
 * A user-supplied `text` replaces the built-in wording; `extra` is appended.
 */
export function buildSectionText(config) {
  let body
  if (typeof config.text === 'string' && config.text.trim() !== '') {
    body = config.text
  } else {
    body = buildBuiltInText(config)
  }
  if (typeof config.extra === 'string' && config.extra.trim() !== '') {
    body = `${body}\n${config.extra.trim()}\n`
  }
  return body
}

/** Built-in wording for the resolved config, in zh or en. */
export function buildBuiltInText(config) {
  const useEnglish = /^en\b/i.test(config.language.trim())
  const opts = {
    maxSentences: config.maxSentences,
    minToolCalls: config.minToolCalls,
    style: config.style,
    reportBlockers: config.reportBlockers,
    ackSteering: config.ackSteering,
    announcePlan: config.announcePlan,
    language: config.language,
  }
  return useEnglish ? enText(opts) : zhText(opts)
}

/**
 * Turn a loader-passed config into a plain object.
 *
 * The host resolves a declared `Config` schema into *volatile references*: every
 * field marked `.volatile()` becomes a frozen `{ get() }` box so the loader can
 * swap its value in place when the settings page saves. All other fields arrive
 * as plain values.
 *
 * @param config - the object the loader passed to `apply` (may be undefined).
 * @returns a fresh plain object with every reference unwrapped.
 */
export function plainValues(config) {
  if (config === undefined || config === null) return {}
  if (typeof config !== 'object' || Array.isArray(config)) return {}
  const out = {}
  for (const key of Object.keys(config)) {
    const value = config[key]
    out[key] =
      value !== null && typeof value === 'object' && typeof value.get === 'function'
        ? (() => {
            try {
              return value.get()
            } catch {
              // A reference that cannot be read behaves like an unset field.
              return undefined
            }
          })()
        : value
  }
  return out
}

/**
 * Read the narration-relevant facts out of one assistant message.
 *
 * A step "narrated" when it contains at least one non-empty plain text block.
 * Reasoning blocks do not count: they are the internal chain of thought, not the
 * visible progress note the plugin is asking for. Tool-call blocks are counted so
 * the caller can tell a silent tool step (tool calls, no text) from a final
 * answer (text, no tool calls).
 *
 * @param message - `assistant/message` payload (`{ content: blocks[] }`).
 */
export function analyzeAssistantMessage(message) {
  const content = message !== null && typeof message === 'object' && Array.isArray(message.content) ? message.content : []
  let hasText = false
  let toolCalls = 0
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'tool-call') {
      toolCalls += 1
    } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      hasText = true
    }
  }
  return { hasText, toolCalls }
}

/**
 * Per-session narration state machine behind the dynamic reminder.
 *
 * It is fed from `session/event` (turn/start resets, every assistant message
 * updates the silent-step counter) and read lazily from the reminder section's
 * text function, which receives the prompt-assembly context carrying
 * `context.agent.session`. Nothing is written to the session and no message is
 * fabricated: the only effect is one extra line in the *next* system prompt.
 */
export function createNarrationTracker() {
  /** @type {Map<string, {turn: number, silentSteps: number, toolSteps: number, narratedSteps: number, lastStep: number}>} */
  const states = new Map()

  /** A stable key for a session object, its id, or undefined. */
  function keyOf(session) {
    if (typeof session === 'string' && session !== '') return session
    if (session !== null && typeof session === 'object' && typeof session.id === 'string' && session.id !== '') {
      return session.id
    }
    return undefined
  }

  function stateFor(key) {
    let state = states.get(key)
    if (state === undefined) {
      state = { turn: 0, silentSteps: 0, toolSteps: 0, narratedSteps: 0, lastStep: 0 }
      states.set(key, state)
    }
    return state
  }

  return {
    keyOf,

    /**
     * Feed one `session/event` pair: `(session, event)`.
     * Unknown event types and session-less events are ignored.
     */
    observe(session, event) {
      const key = keyOf(session)
      if (key === undefined || event === null || typeof event !== 'object') return undefined
      const state = stateFor(key)

      if (event.type === 'turn/start') {
        state.turn = Number.isFinite(event.data?.turn) ? event.data.turn : state.turn + 1
        state.silentSteps = 0
        state.toolSteps = 0
        state.narratedSteps = 0
        state.lastStep = 0
        return state
      }

      if (event.type !== 'assistant/message') return state
      const { hasText, toolCalls } = analyzeAssistantMessage(event.data?.message)
      if (Number.isFinite(event.data?.step)) state.lastStep = event.data.step
      if (toolCalls > 0) {
        state.toolSteps += 1
        if (hasText) {
          // A narrated tool step clears the streak: the model just spoke.
          state.silentSteps = 0
          state.narratedSteps += 1
        } else {
          state.silentSteps += 1
        }
      }
      return state
    },

    /** Silent tool steps in the current turn, or 0 for an unknown session. */
    silentSteps(session) {
      const key = keyOf(session)
      return key === undefined ? 0 : stateFor(key).silentSteps
    },

    /** State snapshot (tests / diagnostics). */
    state(session) {
      const key = keyOf(session)
      return key === undefined ? undefined : { ...stateFor(key) }
    },
  }
}

/** Plugin name used by Cordis when the row omits one. */
export const name = 'interim-narration'

/** Host services this plugin needs. */
export const inject = ['systemPrompt']

/** Rotate the debug log once it grows past this many bytes. */
export const MAX_LOG_BYTES = 64 * 1024

/** Where debug lines go when no explicit `logFile` is configured. */
export function defaultLogFile() {
  const home = process.env.DSH_HOME ?? os.homedir()
  const base = home === os.homedir() ? path.join(home, '.dsh') : home
  return path.join(base, 'dsh-interim-narration.log')
}

/** Append one line to the debug log, rotating it when it gets large. */
export function appendLog(file, message) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    try {
      if (fs.statSync(file).size > MAX_LOG_BYTES) fs.truncateSync(file, 0)
    } catch {
      // A missing file is the normal first-write case.
    }
    fs.appendFileSync(file, `${new Date().toISOString()} [pid ${process.pid}] ${message}\n`)
  } catch {
    // A bad log path must never affect the plugin itself.
  }
}

/**
 * Mount the prompt section.
 *
 * The section is always registered — even when `enabled` is false — because the
 * prompt registry renders its body lazily: `text` is a function that reads the
 * current config on every assembly. That is what makes a settings save take
 * effect on the very next reply, while `enabled: false` simply contributes an
 * empty section.
 *
 * @param ctx - Cordis context with the `systemPrompt` service.
 * @param config - loader-resolved config (volatile fields arrive as references).
 */
export function apply(ctx, config) {
  const raw = config ?? {}

  /** Read the current config (unwrapping volatile references) and validate it. */
  const settings = () => resolveConfig(plainValues(raw))

  /** Debug-only logger; also leaves evidence that the section is mounted. */
  const log = (message) => {
    const current = settings()
    if (!current.debug) return
    const file = current.logFile.trim() !== '' ? current.logFile.trim() : defaultLogFile()
    appendLog(file, message)
  }

  // Fail fast on a malformed profile patch, with a readable message.
  const mounted = settings()

  // The dynamic reminder needs a little per-session memory: which steps called a
  // tool without any visible narration. It is fed from the session event stream
  // and read from the reminder's lazy text function (see below).
  const tracker = createNarrationTracker()

  /** The session object for a prompt-assembly context, if the host passed one. */
  const sessionOf = (context) =>
    context !== null && typeof context === 'object' ? context.agent?.session : undefined

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: mounted.order,
        interpolate: false,
        text: () => {
          const current = settings()
          return current.enabled ? buildSectionText(current) : ''
        },
      }),
    'interim-narration.section()',
  )

  // A second, much shorter section near the end of the system prompt. Long
  // turns drift towards silent tool chains; this reminder is the last rule the
  // model reads before it starts working. When a step was silent, the reminder
  // escalates for the next request — the mechanism-level safety net.
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: REMINDER_SECTION_NAME,
        order: DEFAULT_REMINDER_ORDER,
        interpolate: false,
        text: (context) => {
          const current = settings()
          if (!current.enabled || !current.reminder) return ''
          const silentSteps = current.enforce ? tracker.silentSteps(sessionOf(context)) : 0
          if (silentSteps > 0 && silentSteps >= current.escalateAfter) {
            log(
              `reminder-escalated silentSteps=${silentSteps} escalateAfter=${current.escalateAfter} ` +
                `session=${tracker.keyOf(sessionOf(context)) ?? 'unknown'}`,
            )
          }
          return buildReminderText(current, { silentSteps })
        },
      }),
    'interim-narration.reminder()',
  )

  // Session events drive the tracker. `session/event` is broadcast on the shared
  // event registry as `(session, event)`; a plugin that cannot see it simply
  // keeps the static reminder (silentSteps stays 0), so this stays optional.
  if (typeof ctx.on === 'function') {
    ctx.effect(
      () =>
        ctx.on('session/event', (session, event) => {
          tracker.observe(session, event)
        }),
      'interim-narration.session-tracking',
    )
  }

  // Debug trail for live settings edits. The loader emits this after it has
  // swapped the volatile references in place.
  if (typeof ctx.on === 'function') {
    ctx.effect(
      () =>
        ctx.on('loader/volatile-update', (paths) => {
          const current = settings()
          log(
            `volatile-update paths=${JSON.stringify(paths ?? [])} ` +
              `enabled=${current.enabled} style=${current.style} sectionChars=${buildSectionText(current).length}`,
          )
        }),
      'interim-narration.volatile-log',
    )
  }

  const text = buildSectionText(mounted)
  const reminderText = buildReminderText(mounted)
  log(
    `mounted order=${mounted.order} style=${mounted.style} maxSentences=${mounted.maxSentences} ` +
      `minToolCalls=${mounted.minToolCalls} enabled=${mounted.enabled} ` +
      `reminder=${mounted.reminder} enforce=${mounted.enforce} escalateAfter=${mounted.escalateAfter} ` +
      `sectionChars=${text.length} reminderChars=${reminderText.length}`,
  )
  if (mounted.debug) {
    appendLog(logTarget(mounted), `--- section text ---\n${text}\n--- end ---`)
    appendLog(logTarget(mounted), `--- reminder text ---\n${reminderText}\n--- end ---`)
  }
}

/** Resolve the configured (or default) log file for the given settings. */
function logTarget(current) {
  return current.logFile.trim() !== '' ? current.logFile.trim() : defaultLogFile()
}
