/**
 * dsh-interim-narration — browser half.
 *
 * Adds the plugin's settings page to the DSH Plugins page: the
 * `dsh-interim-narration` row gets a "配置" control whose page edits the
 * volatile fields of the host plugin's `Config` schema. Saves go through the
 * settings service (`configForms` → Host `settings`), are persisted into the
 * active profile's Cordis patch, and reach the running plugin in place — no
 * reload of the plugin, no YAML editing.
 *
 * The page is registered only while the Host actually serves this namespace, so
 * a deployment that disabled the plugin shows no trace of it.
 *
 * The page also carries a small "display" block: the narration only helps if the
 * user can actually see the process text, so the block writes the Chat surface's
 * own settings (`ui-chat.transcriptView` / `ui-chat.collapseTiming`) through the
 * same settings service. It never changes them behind the user's back — only the
 * controls (and one "recommended" button) do, when clicked.
 *
 * @module dsh-interim-narration/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-interim-narration',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // Only modules available in the shell's frozen module table.
    const react = require('react')

    /** Settings namespace: the loader entry id of the host plugin row. */
    const SETTINGS_NS = 'dsh-interim-narration'

    /** Key of the row this page configures: `<bundle package>#<row id>`. */
    const ROW_KEY = 'dsh-interim-narration#dsh-interim-narration'

    /**
     * Chat surface settings namespace (host package ui-chat). Its four fields are
     * volatile, so the settings service serves them and the row page can write
     * them through `configForms`.
     */
    const CHAT_SETTINGS_NS = 'ui-chat'

    /** Slash command contributed to the composer's `/` menu (newer hosts only). */
    const COMMAND_NAME = 'narration'

    /** Dictionary namespace owned by this plugin. */
    const LOCALE_NS = 'interimNarration'

    /** Fields the settings page edits (all `.volatile()` in the host schema). */
    const EDITABLE = [
      'enabled',
      'style',
      'contract',
      'maxSentences',
      'minToolCalls',
      'language',
      'debug',
      'reportBlockers',
      'ackSteering',
      'announcePlan',
      'reminder',
      'enforce',
      'escalateAfter',
    ]

    /** Fallback values, used only before the first Host snapshot arrives. */
    const DEFAULTS = {
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
    }

    /** Sentences a preset allows; mirrors STYLE_SENTENCES in the host half. */
    const STYLE_BUDGET = { concise: 2, standard: 3, verbose: 5 }

    // ── Prompt builders (mirror of lib/core.js) ───────────────────────────────
    // The settings page previews exactly what the host injects. The browser half
    // cannot import host code, so the wording templates are duplicated here and
    // `test/client-smoke.mjs` compares the two implementations so they cannot
    // drift apart silently. Keep this block in sync with lib/core.js.

    function zhTextC(opts) {
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

    function enTextC(opts) {
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

    function zhCompactC(opts) {
      const max = opts.maxSentences
      const min = opts.minToolCalls
      const styleLine =
        opts.style === 'concise'
          ? '- 更简：只讲结论和下一步。'
          : opts.style === 'verbose'
            ? '- 更详：补关键依据、数字和风险判断。'
            : '- 先结论，再必要依据。'
      const blockerLine = opts.reportBlockers ? '- 失败或改变计划：先说事实和影响，再说怎么调整。' : ''
      const steeringLine = opts.ackSteering ? '- 用户插话：先一句话回应，再继续原工作。' : ''
      const openingLine = opts.announcePlan
        ? '- 调用任何工具之前，先用 1–2 句正文开场：你怎么理解消息、准备怎么做、第一步是什么。'
        : '- 调用任何工具之前，先写一句正文说明你准备做什么。'
      const simpleTaskLine = opts.announcePlan
        ? `- 简单任务（不超过 ${min} 次工具调用）可省略中间叙述，但开场保留。`
        : `- 简单任务（不超过 ${min} 次工具调用）可直接给最终回答。`

      return `## 过程叙述（边做边说）

用户看不到你的工作状态，只能看到零散的工具行。请在过程里主动说明：

${openingLine}
- 每批工具调用后、下一批前，写 1–${max} 句正文：刚完成什么、得出什么结论、下一步做什么。
- 硬性要求：只要这一轮调用了工具，就必须至少写一段过程叙述；不允许「工具调用 → 工具调用」全程静默。
${simpleTaskLine}
${styleLine}
${blockerLine}
${steeringLine}
- 只写新增信息、避免空话；用普通段落，不写进思考内容；任务完成后照常给完整最终回答。
`.replace(/\n{3,}/g, '\n\n')
    }

    function enCompactC(opts) {
      const max = opts.maxSentences
      const min = opts.minToolCalls
      const styleLine =
        opts.style === 'concise'
          ? '- Be brief: conclusion and next step.'
          : opts.style === 'verbose'
            ? '- Be thorough: key evidence, numbers, risk judgment.'
            : '- Conclusion first, then only the needed evidence.'
      const blockerLine = opts.reportBlockers ? '- Failures or plan changes: state the fact and impact first, then how you adapt.' : ''
      const steeringLine = opts.ackSteering ? '- User interjects: answer in one sentence, then continue.' : ''
      const openingLine = opts.announcePlan
        ? '- Before any tool call, open with 1–2 sentences: how you read the message, what you will do, and the first step.'
        : '- Before any tool call, write one sentence about what you are about to do.'
      const simpleTaskLine = opts.announcePlan
        ? `- Simple tasks (${min} tool calls or fewer) may skip the middle notes but keep the opening.`
        : `- Simple tasks (${min} tool calls or fewer) may go straight to the final answer.`

      return `## Interim narration (narrate while you work)

The user only sees scattered tool rows, not your working state. Say what you are doing in ordinary reply text:

${openingLine}
- After each tool batch and before the next one, write 1–${max} sentences: what just finished, what you concluded, what comes next.
- Hard requirement: if this turn calls any tool, it must contain at least one paragraph of narration; never chain tool calls in complete silence.
${simpleTaskLine}
${styleLine}
${blockerLine}
${steeringLine}
- Only new information; no filler; plain paragraphs, never inside reasoning; finish with a complete standalone answer.
`.replace(/\n{3,}/g, '\n\n')
    }

    function zhReminderC(opts) {
      const opening = opts.announcePlan
        ? '调用第一个工具之前，先用 1–2 句正文说明：你怎么理解这条消息、准备怎么做、第一步是什么。'
        : '调用第一个工具之前，先写一句正文说明你准备做什么。'
      return `## 过程叙述提醒

${opening}之后每批工具调用之间，用 1–2 句正文说明刚完成什么、接下来做什么。这些正文写在正常回复里，用户会直接看到；不要整轮只调工具、不说话。
`
    }

    function enReminderC(opts) {
      const opening = opts.announcePlan
        ? 'Before the first tool call, open with 1–2 sentences: how you read the message, what you will do, and the first step.'
        : 'Before the first tool call, open with one sentence about what you are about to do.'
      return `## Narration reminder

${opening} Between tool-call batches, add 1–2 sentences about what just finished and what comes next. Write them as ordinary reply text — the user sees them directly; never run a whole turn of tool calls in silence.
`
    }

    /** Normalize a draft config the way the host's `resolveConfig` does. */
    function resolveLocal(raw) {
      const style = STYLE_BUDGET[raw?.style] ? raw.style : 'standard'
      const configured = Number.isFinite(raw?.maxSentences) ? raw.maxSentences : 0
      return {
        enabled: raw?.enabled !== false,
        style,
        contract: raw?.contract === 'compact' ? 'compact' : 'full',
        maxSentences: configured === 0 ? STYLE_BUDGET[style] : configured,
        minToolCalls: Number.isFinite(raw?.minToolCalls) ? raw.minToolCalls : 2,
        language: typeof raw?.language === 'string' ? raw.language : 'auto',
        announcePlan: raw?.announcePlan !== false,
        reportBlockers: raw?.reportBlockers !== false,
        ackSteering: raw?.ackSteering !== false,
        reminder: raw?.reminder !== false,
      }
    }

    /**
     * Preview of exactly what the host builds for the given draft.
     *
     * `language: auto` needs the user's own message to decide, so the preview
     * renders Chinese for it and says so in the note.
     */
    function previewFor(raw) {
      const config = resolveLocal(raw)
      const useEnglish = /^en\b/i.test(config.language.trim())
      const opts = {
        style: config.style,
        maxSentences: config.maxSentences,
        minToolCalls: config.minToolCalls,
        announcePlan: config.announcePlan,
        reportBlockers: config.reportBlockers,
        ackSteering: config.ackSteering,
      }
      const text = !config.enabled
        ? ''
        : config.contract === 'compact'
          ? useEnglish
            ? enCompactC(opts)
            : zhCompactC(opts)
          : useEnglish
            ? enTextC(opts)
            : zhTextC(opts)
      const reminder = config.enabled && config.reminder ? (useEnglish ? enReminderC(opts) : zhReminderC(opts)) : ''
      const chars = text.length
      const reminderChars = reminder.length
      return {
        text,
        reminder,
        chars,
        reminderChars,
        approxTokens: Math.ceil((chars + reminderChars) / 2.5),
      }
    }

    /** English copy. */
    const en = {
      title: 'Interim narration',
      description:
        'Make the model narrate its progress in plain reply text between tool calls (detail level, sentence budget, language).',
      enabled: 'Enable interim narration',
      enabledHint: 'Off means the prompt section is empty; nothing else changes.',
      style: 'Narration detail',
      styleConcise: 'Concise (2 sentences)',
      styleStandard: 'Standard (3 sentences)',
      styleVerbose: 'Verbose (5 sentences)',
      contract: 'Prompt contract',
      contractFull: 'Full (explanatory)',
      contractCompact: 'Compact (same rules, fewer words)',
      contractHint: 'Compact keeps every rule but drops explanatory sentences; it saves prompt tokens.',
      previewTitle: 'Prompt preview',
      previewMeta: '{chars} characters · ~{tokens} tokens',
      previewNote: 'Exactly what the host injects for these settings. "Match the user" renders Chinese here; the real language follows the latest user message.',
      maxSentences: 'Sentences per note',
      maxSentencesHint: '1-10. Limits how long each progress note may be.',
      minToolCalls: 'Skip narration for tasks with at most',
      minToolCallsHint: 'Tool calls. 0-10: simple tasks may go straight to the answer.',
      language: 'Prompt language',
      languageAuto: 'Match the user (auto)',
      languageZh: 'Chinese',
      languageEn: 'English',
      debug: 'Write debug log',
      debugHint: 'Appends mount/update lines to dsh-interim-narration.log in the DSH home.',
      reportBlockers: 'Explain blockers first',
      reportBlockersHint: 'When something fails or the plan changes, state the fact and impact before adapting.',
      ackSteering: 'Acknowledge user interjections',
      ackSteeringHint: 'Answer the user in one sentence before continuing the current work.',
      announcePlan: 'Open with your understanding and plan',
      announcePlanHint: 'Before the first tool call, say how you read the message, what you plan to do, and the first step.',
      reminder: 'Add a short reminder at the end of the prompt',
      reminderHint: 'A second short section near the end of the system prompt; long turns are less likely to forget to narrate.',
      enforce: 'Escalate after a silent step',
      enforceHint: 'Watch the session and sharpen the reminder for the next step when a tool call carried no narration.',
      escalateAfter: 'Escalate after this many silent steps',
      escalateAfterHint: '1-5. 1 is the most eager; raise it to tolerate longer silent stretches.',
      styleHint: 'Presets default to 2 / 3 / 5 sentences; set "Sentences per note" to override the preset.',
      maxSentencesHint: '0 = follow the detail preset; 1-10 overrides it.',
      maxSentencesFollow: 'Following the preset: {count} sentences',
      sectionBasic: 'Basics',
      sectionPrompt: 'Opening and reminder',
      sectionAdvanced: 'Advanced',
      sectionDisplay: 'Display in the chat',
      resetField: 'Reset to default',
      resetAll: 'Reset all to defaults',
      visibilityCurrent: 'Current',
      commandLabel: '/narration — narration settings',
      commandDescription: 'Quickly switch the narration detail, on/off state and chat display.',
      commandGroupStyle: 'Detail',
      commandGroupSwitch: 'On / off',
      commandGroupDisplay: 'Chat display',
      commandTurnOn: 'Turn narration on',
      commandTurnOff: 'Pause narration',
      commandDisplayVisible: 'Keep the process visible (Detailed + On next message)',
      commandDisplayDefault: 'Default display (Standard + After answer)',
      commandDisplayUnavailable: 'Chat display settings are unavailable in this build.',
      commandSearchPlaceholder: 'Filter…',
      commandSearchEmpty: 'No matches',
      visibilityTitle: 'Display in the chat',
      visibilityDescription: 'The narration is normal reply text inside the turn process. These two Chat settings decide whether the process stays expanded.',
      transcriptView: 'Work-step display',
      viewCompact: 'Compact',
      viewStandard: 'Standard',
      viewDetailed: 'Detailed',
      viewVerbose: 'Fully expanded',
      collapseTiming: 'Collapse work steps',
      collapseCompletion: 'After the answer finishes',
      collapseNextInput: 'On the next message',
      presetVisible: 'Recommended: keep the process visible',
      presetVisibleHint: 'Sets "Detailed" + "On the next message", the combination the narration is designed for.',
      visibilitySaved: 'Display updated',
      visibilityFailed: 'The display setting was not accepted',
      visibilityUnavailable: 'The chat display settings are unavailable in this build.',
      visibilityNote: 'Same as Settings → General → Work-step display. Only the controls here change it; nothing is changed automatically.',
      note: 'Saved values apply immediately: the next reply follows the new settings. Order, fully custom text and other install-time options still live in the profile Cordis patch.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      discard: 'Discard changes',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
    }

    /** Simplified Chinese copy. */
    const zh = {
      title: '过程叙述',
      description: '让模型在工具调用之间用正文说明进展（详细度、句数、语言等）。',
      enabled: '启用过程叙述',
      enabledHint: '关闭后提示词段为空，其他行为不变。',
      style: '叙述详细度',
      styleConcise: '简洁（2 句）',
      styleStandard: '标准（3 句）',
      styleVerbose: '详细（5 句）',
      contract: '提示词契约',
      contractFull: '完整（含解释）',
      contractCompact: '精简（规则相同、少解释）',
      contractHint: '精简契约保留全部规则、去掉解释性句子，能省提示词 token。',
      previewTitle: '提示词预览',
      previewMeta: '{chars} 字符 · 约 {tokens} tokens',
      previewNote: '与本设置下宿主实际注入的内容一致。「跟随用户语言」在这里按中文展示；真实语言跟随最近一条用户消息。',
      maxSentences: '每段最多句数',
      maxSentencesHint: '1–10，限制每段过程说明的长度。',
      minToolCalls: '简单任务免叙述（工具调用不超过）',
      minToolCallsHint: '0–10 次；小任务可直接给最终回答，不必逐步叙述。',
      language: '提示词语言',
      languageAuto: '跟随用户语言（自动）',
      languageZh: '中文',
      languageEn: 'English',
      debug: '写入调试日志',
      debugHint: '在 DSH 主目录的 dsh-interim-narration.log 追加挂载/更新记录。',
      reportBlockers: '遇到阻碍先说明',
      reportBlockersHint: '失败、受阻或计划变更时，先说事实和影响，再说明怎么调整。',
      ackSteering: '回应中途插话',
      ackSteeringHint: '用户中途插话时，先用一句话回应，再继续当前工作。',
      announcePlan: '开场先说理解与计划',
      announcePlanHint: '调用工具之前，先说明你怎么理解这条消息、准备怎么做、第一步是什么。',
      reminder: '在提示词末尾加一条提醒',
      reminderHint: '在系统提示尾部再放一段简短提醒，长任务更不容易忘记叙述。',
      enforce: '静默后自动加压提醒',
      enforceHint: '监听会话：某一工具步骤没有任何正文时，下一步的提醒会变得更明确。',
      escalateAfter: '连续静默几步后加压',
      escalateAfterHint: '1–5。1 最积极；调大可容忍更长的静默段。',
      styleHint: '档位默认 2／3／5 句；设置「每段最多句数」可覆盖档位。',
      maxSentencesHint: '0 = 跟随详细度档位；1–10 覆盖档位。',
      maxSentencesFollow: '跟随档位：{count} 句',
      sectionBasic: '基本',
      sectionPrompt: '开场与提醒',
      sectionAdvanced: '进阶',
      sectionDisplay: '聊天里的显示',
      resetField: '恢复默认',
      resetAll: '全部恢复默认',
      visibilityCurrent: '当前',
      commandLabel: '/narration 过程叙述',
      commandDescription: '快速切换叙述详细度、开关与聊天显示。',
      commandGroupStyle: '叙述详细度',
      commandGroupSwitch: '开关',
      commandGroupDisplay: '聊天显示',
      commandTurnOn: '开启过程叙述',
      commandTurnOff: '暂停过程叙述',
      commandDisplayVisible: '让过程全程可见（详细 + 下次输入时）',
      commandDisplayDefault: '恢复默认显示（标准 + 回答结束后）',
      commandDisplayUnavailable: '当前版本读不到聊天显示设置。',
      commandSearchPlaceholder: '筛选…',
      commandSearchEmpty: '没有匹配项',
      visibilityTitle: '聊天里的显示',
      visibilityDescription: '过程叙述是轮次过程里的普通正文；下面两个「聊天」设置决定过程是保持展开还是收起。',
      transcriptView: '工作步骤展示',
      viewCompact: '简洁',
      viewStandard: '标准',
      viewDetailed: '详细（推荐）',
      viewVerbose: '完全展开',
      collapseTiming: '工作步骤收起时机',
      collapseCompletion: '回答结束后',
      collapseNextInput: '下次有新消息时',
      presetVisible: '推荐：让过程全程可见',
      presetVisibleHint: '一次设成「详细」+「下次有新消息时」，这是过程叙述最合适的组合。',
      visibilitySaved: '显示设置已更新',
      visibilityFailed: '显示设置没有被接受',
      visibilityUnavailable: '当前版本读不到聊天显示设置。',
      visibilityNote: '等同于「设置 → 通用 → 工作步骤展示」。只有这里的控件会改它，插件不会自动修改。',
      note: '保存后立即生效：下一轮回复开始按新设置叙述。顺序、完全自定义文本等安装期选项仍在 profile 的 Cordis patch 里编辑。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      discard: '撤销更改',
      unavailable: '该插件当前未加载，暂时无法配置。',
      saveFailed: '本部署没有接受这些值，已保留供你修改。',
    }

    /** Plain inline styles; colors come from the shell's alias tokens when present. */
    const S = {
      root: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 0', maxWidth: '640px' },
      note: { fontSize: '12px', lineHeight: 1.6, opacity: 0.72 },
      row: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '24px' },
      rowText: { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 auto' },
      label: { fontSize: '13px' },
      hint: { fontSize: '11.5px', lineHeight: 1.5, opacity: 0.62 },
      control: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '6px' },
      number: { width: '88px', padding: '3px 6px', font: 'inherit' },
      select: { minWidth: '190px', padding: '3px 6px', font: 'inherit' },
      footer: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      button: { font: 'inherit', padding: '4px 14px', cursor: 'pointer' },
      buttonDisabled: { font: 'inherit', padding: '4px 14px', cursor: 'default', opacity: 0.55 },
      reset: { font: 'inherit', padding: '1px 8px', cursor: 'pointer', lineHeight: 1.4, opacity: 0.75 },
      status: { fontSize: '12px', opacity: 0.75 },
      error: { fontSize: '12px', color: 'var(--dsw-alias-red-6, #d4380d)', whiteSpace: 'pre-wrap' },
      section: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        marginTop: '4px',
        paddingTop: '14px',
        borderTop: '1px solid rgba(127, 127, 127, 0.2)',
      },
      sectionHead: { display: 'flex', flexDirection: 'column', gap: '2px' },
      sectionTitle: { fontSize: '13px', fontWeight: 600 },
      preview: {
        margin: 0,
        padding: '10px 12px',
        maxHeight: '260px',
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        fontSize: '12px',
        lineHeight: 1.6,
        fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)',
        background: 'rgba(127, 127, 127, 0.08)',
        borderRadius: '6px',
      },
    }

    /** Snapshot reader that tolerates a partial scope object. */
    function readSnapshot(scope) {
      try {
        if (scope && typeof scope.getSnapshot === 'function') return scope.getSnapshot() ?? {}
      } catch {
        // fall through to the neutral snapshot
      }
      return { status: 'unavailable', value: {}, revision: 0, writable: false }
    }

    /** Compare two plain config objects by value (field order is stable). */
    function sameValues(a, b) {
      const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
      for (const key of keys) {
        if (JSON.stringify(a?.[key]) !== JSON.stringify(b?.[key])) return false
      }
      return true
    }

    /** Render a text/control row (an optional reset button follows the control). */
    function row(t, key, label, hint, control, reset) {
      return react.createElement(
        'div',
        { key, style: S.row },
        react.createElement(
          'div',
          { style: S.rowText },
          react.createElement('div', { style: S.label }, label),
          hint ? react.createElement('div', { style: S.hint }, hint) : null,
        ),
        react.createElement('div', { style: S.control }, control, reset ?? null),
      )
    }

    /** A one-field "reset" button (unset = fall back to the built-in default). */
    function resetButton(t, key, onReset, disabled) {
      return react.createElement(
        'button',
        {
          key: `reset-${key}`,
          type: 'button',
          title: t('resetField'),
          style: disabled ? S.buttonDisabled : S.reset,
          disabled,
          onClick: () => onReset(key),
        },
        '↺',
      )
    }

    /** One checkbox row. */
    function toggleRow(t, draft, setField, key, label, hint, disabled, reset) {
      return row(
        t,
        key,
        label,
        hint,
        react.createElement('input', {
          type: 'checkbox',
          checked: Boolean(draft[key]),
          disabled,
          style: { width: '16px', height: '16px' },
          onChange: (event) => setField(key, Boolean(event.currentTarget.checked)),
        }),
        reset,
      )
    }

    /** One select row. */
    function selectRow(t, draft, setField, key, label, hint, disabled, options, reset) {
      return row(
        t,
        key,
        label,
        hint,
        react.createElement(
          'select',
          {
            style: S.select,
            value: draft[key] ?? '',
            disabled,
            onChange: (event) => setField(key, event.currentTarget.value),
          },
          ...options.map(([value, text]) => react.createElement('option', { key: value, value }, text)),
        ),
        reset,
      )
    }

    /** One numeric row. */
    function numberRow(t, draft, setField, key, label, hint, disabled, min, max, reset) {
      return row(
        t,
        key,
        label,
        hint,
        react.createElement('input', {
          type: 'number',
          min,
          max,
          step: 1,
          style: S.number,
          value: draft[key] ?? '',
          disabled,
          onChange: (event) => {
            const next = Number.parseInt(event.currentTarget.value, 10)
            setField(key, Number.isFinite(next) ? next : undefined)
          },
        }),
        reset,
      )
    }

    /** Write one field through whichever controller API the host exposes. */
    async function setThroughScope(scope, key, value) {
      if (scope && typeof scope.set === 'function') return scope.set(key, value)
      const current = readSnapshot(scope)
      return scope.mutate([{ op: 'set', path: [key], value }], current.revision)
    }

    /** Rows for the `/narration` command: detail, on/off and display presets. */
    function commandOptions(t, scope) {
      const current = readSnapshot(scope).value ?? {}
      const style = current.style ?? DEFAULTS.style
      const enabled = current.enabled !== false
      const styleGroup = { name: 'style', label: t('commandGroupStyle') }
      const rows = [
        ['style:concise', 'styleConcise'],
        ['style:standard', 'styleStandard'],
        ['style:verbose', 'styleVerbose'],
      ].map(([id, key]) => {
        const value = id.slice('style:'.length)
        return {
          id,
          label: `${t(key)}${style === value ? ' ✓' : ''}`,
          group: styleGroup,
          ...(style === value ? { active: true } : {}),
        }
      })
      rows.push({
        id: 'toggle-enable',
        label: enabled ? t('commandTurnOff') : t('commandTurnOn'),
        group: { name: 'switch', label: t('commandGroupSwitch') },
      })
      rows.push({
        id: 'display-visible',
        label: t('commandDisplayVisible'),
        group: { name: 'display', label: t('commandGroupDisplay') },
      })
      rows.push({
        id: 'display-default',
        label: t('commandDisplayDefault'),
        group: { name: 'display', label: t('commandGroupDisplay') },
      })
      return rows
    }

    /** Apply one `/narration` pick through the settings controllers. */
    async function commandSelect(option, scope, chatScope, t) {
      const id = option && typeof option.id === 'string' ? option.id : ''
      if (id.startsWith('style:')) {
        await setThroughScope(scope, 'style', id.slice('style:'.length))
        return
      }
      if (id === 'toggle-enable') {
        const current = readSnapshot(scope).value ?? {}
        await setThroughScope(scope, 'enabled', current.enabled === false)
        return
      }
      if (id !== 'display-visible' && id !== 'display-default') return
      if (!chatScope) throw new Error(t('commandDisplayUnavailable'))
      const pair = id === 'display-visible' ? ['detailed', 'next-input'] : ['standard', 'completion']
      const write = () =>
        chatScope.mutate(
          [
            { op: 'set', path: ['transcriptView'], value: pair[0] },
            { op: 'set', path: ['collapseTiming'], value: pair[1] },
          ],
          readSnapshot(chatScope).revision,
        )
      try {
        await write()
      } catch (error) {
        // The mirror may be a revision behind; retry once with the fresh one.
        try {
          await write()
        } catch {
          throw error
        }
      }
    }

    /** The page's summary line in the row list. */
    function summaryLine(props) {
      return (props.t ?? props.locale?.bind?.(LOCALE_NS) ?? ((key) => key))('description')
    }

    /** The settings page itself. */
    function NarrationSettingsPage(props) {
      const t = props.t ?? ((key) => key)
      const scope = props.scope
      const [snapshot, setSnapshot] = react.useState(() => readSnapshot(scope))
      const [draft, setDraft] = react.useState(() => ({ ...DEFAULTS, ...(readSnapshot(scope).value ?? {}) }))
      const [status, setStatus] = react.useState(null)

      // Chat display settings are a second, independent namespace. This block
      // only exists because the narration is useless if the process is folded
      // away; it still writes only when the user clicks a control.
      const chatScope = props.chatScope ?? null
      const [chatSnapshot, setChatSnapshot] = react.useState(() => readSnapshot(chatScope))
      const [chatStatus, setChatStatus] = react.useState(null)

      // Follow the shared settings mirror so a save from another tab/page shows up.
      react.useEffect(() => {
        let dispose
        const sync = () => setSnapshot(readSnapshot(scope))
        sync()
        try {
          if (scope && typeof scope.subscribe === 'function') dispose = scope.subscribe(sync)
        } catch {
          // A non-subscribable scope still renders (and saves through mutate).
        }
        return () => {
          try {
            if (typeof dispose === 'function') dispose()
          } catch {
            // ignore disposal races
          }
        }
      }, [scope])

      // Follow the Chat settings mirror as well (another tab may change it).
      react.useEffect(() => {
        let dispose
        const sync = () => setChatSnapshot(readSnapshot(chatScope))
        sync()
        try {
          if (chatScope && typeof chatScope.subscribe === 'function') dispose = chatScope.subscribe(sync)
        } catch {
          // A non-subscribable scope still renders the note.
        }
        return () => {
          try {
            if (typeof dispose === 'function') dispose()
          } catch {
            // ignore disposal races
          }
        }
      }, [chatScope])

      const server = snapshot.value ?? {}
      const dirty = !sameValues(draft, server)
      const dirtyRef = react.useRef(dirty)
      dirtyRef.current = dirty

      // Adopt accepted server values unless the user is in the middle of editing.
      react.useEffect(() => {
        if (!dirtyRef.current) setDraft({ ...DEFAULTS, ...server })
      }, [snapshot])

      const setField = (key, value) => {
        setStatus(null)
        setDraft((previous) => ({ ...previous, [key]: value }))
      }

      const disabled = snapshot.writable === false || snapshot.status === 'unavailable'

      const chatValue = chatSnapshot.value ?? {}
      const chatDisabled = chatSnapshot.writable === false || chatSnapshot.status === 'unavailable'
      const viewLabels = {
        compact: t('viewCompact'),
        standard: t('viewStandard'),
        detailed: t('viewDetailed'),
        verbose: t('viewVerbose'),
      }
      const collapseLabels = {
        completion: t('collapseCompletion'),
        'next-input': t('collapseNextInput'),
      }
      const currentChat = `${t('visibilityCurrent')}: ${
        viewLabels[chatValue.transcriptView] ?? chatValue.transcriptView ?? '—'
      } · ${collapseLabels[chatValue.collapseTiming] ?? chatValue.collapseTiming ?? '—'}`

      // One field (or the recommended pair) into the Chat namespace. The
      // revision is re-read at call time so two quick clicks do not race; a CAS
      // conflict is retried once with the fresh revision.
      const commitChat = async (ops, attempt = 0) => {
        if (!chatScope) return
        const current = readSnapshot(chatScope)
        if (current.writable === false || current.status === 'unavailable') {
          setChatStatus({ kind: 'error', message: t('visibilityUnavailable') })
          return
        }
        setChatStatus({ kind: 'saving' })
        try {
          await chatScope.mutate(ops, current.revision)
          setChatStatus({ kind: 'saved' })
        } catch (error) {
          if (attempt === 0) return commitChat(ops, 1)
          setChatStatus({ kind: 'error', message: error && error.message ? error.message : String(error) })
        }
      }

      const setVisibility = (key, value) => {
        if (chatDisabled) return
        if (JSON.stringify(chatValue[key]) === JSON.stringify(value)) return
        commitChat([{ op: 'set', path: [key], value }])
      }

      const applyVisiblePreset = () =>
        commitChat([
          { op: 'set', path: ['transcriptView'], value: 'detailed' },
          { op: 'set', path: ['collapseTiming'], value: 'next-input' },
        ])

      const save = async () => {
        if (disabled) return
        const ops = EDITABLE.filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(server[key])).map((key) => ({
          op: 'set',
          path: [key],
          value: draft[key],
        }))
        if (ops.length === 0) {
          setStatus({ kind: 'saved' })
          return
        }
        setStatus({ kind: 'saving' })
        try {
          await scope.mutate(ops, snapshot.revision)
          setStatus({ kind: 'saved' })
        } catch (error) {
          setStatus({ kind: 'error', message: error && error.message ? error.message : String(error) })
        }
      }

      const discard = () => {
        setDraft({ ...DEFAULTS, ...server })
        setStatus(null)
      }

      // Reset writes an `unset` op: it drops the profile override and falls back
      // to the schema default served by the host (nothing is guessed locally).
      const applyReset = async (keys) => {
        if (disabled) return
        setStatus({ kind: 'saving' })
        try {
          if (typeof scope.unset === 'function' && keys.length === 1) {
            await scope.unset(keys[0])
          } else {
            await scope.mutate(
              keys.map((key) => ({ op: 'unset', path: [key] })),
              snapshot.revision,
            )
          }
          setDraft({ ...DEFAULTS, ...readSnapshot(scope).value })
          setStatus({ kind: 'saved' })
        } catch (error) {
          setStatus({ kind: 'error', message: error && error.message ? error.message : String(error) })
        }
      }
      const resetField = (key) => applyReset([key])
      const resetAll = () => applyReset([...EDITABLE])
      const resetFor = (key) => resetButton(t, key, resetField, disabled)

      // The page is grouped into scannable blocks. `maxSentences` 0 means
      // "follow the detail preset", so its hint shows the budget that preset
      // allows right now (the host applies the same rule).
      const styleBudget = STYLE_BUDGET[draft.style] ?? STYLE_BUDGET.standard
      const maxSentencesHint =
        draft.maxSentences === 0
          ? t('maxSentencesFollow').replace('{count}', String(styleBudget))
          : t('maxSentencesHint')

      const basicElements = [
        toggleRow(t, draft, setField, 'enabled', t('enabled'), t('enabledHint'), disabled, resetFor('enabled')),
        selectRow(
          t,
          draft,
          setField,
          'style',
          t('style'),
          t('styleHint'),
          disabled,
          [
            ['concise', t('styleConcise')],
            ['standard', t('styleStandard')],
            ['verbose', t('styleVerbose')],
          ],
          resetFor('style'),
        ),
        selectRow(
          t,
          draft,
          setField,
          'contract',
          t('contract'),
          t('contractHint'),
          disabled,
          [
            ['full', t('contractFull')],
            ['compact', t('contractCompact')],
          ],
          resetFor('contract'),
        ),
        numberRow(
          t,
          draft,
          setField,
          'maxSentences',
          t('maxSentences'),
          maxSentencesHint,
          disabled,
          0,
          10,
          resetFor('maxSentences'),
        ),
        numberRow(
          t,
          draft,
          setField,
          'minToolCalls',
          t('minToolCalls'),
          t('minToolCallsHint'),
          disabled,
          0,
          10,
          resetFor('minToolCalls'),
        ),
        selectRow(
          t,
          draft,
          setField,
          'language',
          t('language'),
          null,
          disabled,
          [
            ['auto', t('languageAuto')],
            ['zh', t('languageZh')],
            ['en', t('languageEn')],
          ],
          resetFor('language'),
        ),
      ]

      const promptElements = [
        toggleRow(
          t,
          draft,
          setField,
          'announcePlan',
          t('announcePlan'),
          t('announcePlanHint'),
          disabled,
          resetFor('announcePlan'),
        ),
        toggleRow(t, draft, setField, 'reminder', t('reminder'), t('reminderHint'), disabled, resetFor('reminder')),
        toggleRow(t, draft, setField, 'enforce', t('enforce'), t('enforceHint'), disabled, resetFor('enforce')),
        numberRow(
          t,
          draft,
          setField,
          'escalateAfter',
          t('escalateAfter'),
          t('escalateAfterHint'),
          disabled,
          1,
          5,
          resetFor('escalateAfter'),
        ),
      ]

      const advancedElements = [
        toggleRow(
          t,
          draft,
          setField,
          'reportBlockers',
          t('reportBlockers'),
          t('reportBlockersHint'),
          disabled,
          resetFor('reportBlockers'),
        ),
        toggleRow(
          t,
          draft,
          setField,
          'ackSteering',
          t('ackSteering'),
          t('ackSteeringHint'),
          disabled,
          resetFor('ackSteering'),
        ),
        toggleRow(t, draft, setField, 'debug', t('debug'), t('debugHint'), disabled, resetFor('debug')),
      ]

      /** Render one titled block of rows. */
      const block = (key, title, children) =>
        react.createElement(
          'div',
          { key, style: S.section },
          react.createElement('div', { style: S.sectionHead }, react.createElement('div', { style: S.sectionTitle }, title)),
          ...children,
        )

      // Exact preview of what the host injects for the current draft.
      const preview = previewFor(draft)
      const previewMeta = t('previewMeta')
        .replace('{chars}', String(preview.chars))
        .replace('{tokens}', String(preview.approxTokens))
      const previewBlock = react.createElement(
        'div',
        { key: 'preview', style: S.section },
        react.createElement(
          'div',
          { style: S.sectionHead },
          react.createElement('div', { style: S.sectionTitle }, t('previewTitle')),
          react.createElement('div', { style: S.hint }, previewMeta),
        ),
        react.createElement(
          'pre',
          { style: S.preview },
          [preview.text, preview.reminder].filter((part) => part !== '').join('\n\n'),
        ),
        react.createElement('div', { style: S.note }, t('previewNote')),
      )

      const visibility = react.createElement(
        'div',
        { key: 'visibility', style: S.section },
        react.createElement(
          'div',
          { style: S.sectionHead },
          react.createElement('div', { style: S.sectionTitle }, t('sectionDisplay')),
          react.createElement('div', { style: S.hint }, t('visibilityDescription')),
        ),
        react.createElement('div', { style: S.note }, currentChat),
        selectRow(t, chatValue, setVisibility, 'transcriptView', t('transcriptView'), null, chatDisabled, [
          ['compact', t('viewCompact')],
          ['standard', t('viewStandard')],
          ['detailed', t('viewDetailed')],
          ['verbose', t('viewVerbose')],
        ]),
        selectRow(t, chatValue, setVisibility, 'collapseTiming', t('collapseTiming'), null, chatDisabled, [
          ['completion', t('collapseCompletion')],
          ['next-input', t('collapseNextInput')],
        ]),
        react.createElement(
          'div',
          { style: S.footer },
          react.createElement(
            'button',
            {
              type: 'button',
              style: chatDisabled ? S.buttonDisabled : S.button,
              disabled: chatDisabled || chatStatus?.kind === 'saving',
              onClick: applyVisiblePreset,
            },
            t('presetVisible'),
          ),
          chatStatus?.kind === 'saving' ? react.createElement('span', { style: S.status }, t('saving')) : null,
          chatStatus?.kind === 'saved' ? react.createElement('span', { style: S.status }, t('visibilitySaved')) : null,
          chatStatus?.kind === 'error'
            ? react.createElement('span', { style: S.error }, `${t('visibilityFailed')}\n${chatStatus.message}`)
            : null,
        ),
        react.createElement('div', { style: S.note }, t('visibilityNote')),
      )

      const footer = react.createElement(
        'div',
        { style: S.footer },
        react.createElement(
          'button',
          {
            type: 'button',
            style: dirty && !disabled ? S.button : S.buttonDisabled,
            disabled: !dirty || disabled || status?.kind === 'saving',
            onClick: save,
          },
          status?.kind === 'saving' ? t('saving') : t('save'),
        ),
        react.createElement(
          'button',
          { type: 'button', style: S.button, disabled: status?.kind === 'saving', onClick: resetAll },
          t('resetAll'),
        ),
        react.createElement(
          'button',
          { type: 'button', style: S.button, disabled: !dirty || status?.kind === 'saving', onClick: discard },
          t('discard'),
        ),
        status?.kind === 'saved' ? react.createElement('span', { style: S.status }, t('saved')) : null,
        status?.kind === 'error'
          ? react.createElement('span', { style: S.error }, `${t('saveFailed')}\n${status.message}`)
          : null,
      )

      return react.createElement(
        'div',
        { style: S.root },
        disabled ? react.createElement('div', { style: S.error }, t('unavailable')) : null,
        block('basic', t('sectionBasic'), basicElements),
        block('prompt', t('sectionPrompt'), promptElements),
        block('advanced', t('sectionAdvanced'), advancedElements),
        previewBlock,
        footer,
        visibility,
        react.createElement('div', { style: S.note }, t('note')),
      )
    }

    /** Required services (cordis fiber inject). */
    const inject = ['slots', 'locale', 'configForms']

    /**
     * Mount the row configuration page while the Host serves this namespace.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(LOCALE_NS)
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'interim-narration: dictionaries')

      const scope = ctx.configForms.get(SETTINGS_NS)
      // The Chat namespace is served by the ui-chat host package. It is read
      // guarded: on a deployment without the chat surface the display block
      // simply renders as unavailable.
      let chatScope = null
      try {
        chatScope = ctx.configForms.get(CHAT_SETTINGS_NS)
      } catch {
        chatScope = null
      }

      ctx.effect(
        () =>
          ctx.configForms.whileServed([SETTINGS_NS], () =>
            ctx.slots.inject('plugins.row.config', () =>
              ctx.slots.register(
                {
                  name: 'plugins.row.config',
                  key: ROW_KEY,
                  order: 40,
                  label: () => t('title'),
                  locale: LOCALE_NS,
                },
                (props) =>
                  props && props.view === 'summary'
                    ? react.createElement(summaryLine, { ...props, t })
                    : react.createElement(NarrationSettingsPage, { ...props, t, scope, chatScope }),
              ),
            ),
          ),
        'interim-narration: row config page',
      )

      // Optional `/narration` composer command (newer hosts only). `ctx.inject`
      // is the dependency form: on a host without the `commandUi` service the
      // callback never runs, so older deployments keep working unchanged.
      ctx.inject(['commandUi'], (commandCtx) => {
        const command = commandCtx.get('commandUi')
        if (!command || typeof command.register !== 'function') return
        commandCtx.effect(
          () =>
            command.register({
              name: COMMAND_NAME,
              label: () => t('commandLabel'),
              description: () => t('commandDescription'),
              available: () => true,
              ui: {
                kind: 'popupSelect',
                searchMode: 'substring',
                searchLabels: () => ({
                  placeholder: t('commandSearchPlaceholder'),
                  empty: t('commandSearchEmpty'),
                  noResults: t('commandSearchEmpty'),
                }),
                options: async () => commandOptions(t, scope),
                onSelect: async (option) => commandSelect(option, scope, chatScope, t),
              },
            }),
          'interim-narration: /narration',
        )
      })
    }

    exports.inject = inject
    exports.apply = apply
    // Test hook: the prompt preview must match the host's builders exactly.
    exports.__preview = previewFor
    return module.exports
  },
})
