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

    /** Host route that reads/applies/reverts the local ui-chat fold patch. */
    const FOLD_PATCH_ROUTE = '/dsh-interim-narration/fold-patch'
    const PANEL_ID = 'interim-narration'

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
      'subagents',
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
      subagents: 'inherit',
    }

    /** Fields owned by each settings tab (interjection has none: it is a patch). */
    /** Version compiled into the client bundle; kept in step with package.json by a test. */
    const PLUGIN_VERSION = '1.1.1'

    const TAB_FIELDS = {
      basic: ['enabled', 'style', 'contract', 'maxSentences', 'minToolCalls', 'language'],
      prompt: ['announcePlan', 'reminder', 'subagents', 'enforce', 'escalateAfter'],
      advanced: ['reportBlockers', 'ackSteering', 'debug'],
    }

    /** ui-chat values restored by the Display tab's own reset. */
    const CHAT_DEFAULTS = { transcriptView: 'standard', collapseTiming: 'completion', foldedReplies: 'all' }

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
- 不要把思考内容复述到正文：推理里已经想过的内容，正文只给结论和判断，不要整段重述。
- 避免空话（「好的，我继续」「现在处理下一部分」这类没有信息量的句子不要单独成段）。
${styleLine}
${blockerLine}
${steeringLine}
- 委派子代理/并行任务：说明委派了什么、你自己同时做什么、什么时候汇总。

### 怎么写
- 普通段落，不使用标题、列表、加粗、代码块；每段开头直接给结论或动作。
- 用与用户相同的语言；写在正常回复正文里，不要写进思考（reasoning）内容。
- 过程叙述是给用户看的过程说明，不是最终答案：任务完成后照常输出完整、独立的最终回答。
- 最终回答只写结论、交付物和必要的使用说明；不要把过程叙述或思考过程在最终回答里再说一遍。
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
- Do not restate your reasoning in the reply text: give the conclusion and judgment only.
- Avoid filler ("Okay, continuing", "Now the next part"): it carries no information.
${styleLine}
${blockerLine}
${steeringLine}
- Subagents/parallel work: say what you delegated, what you do meanwhile, and when you will merge results.

### How to write it
- Plain paragraphs: no headings, lists, bold, or code blocks; open each paragraph with the conclusion or the action.
- Use the same language as the user; put it in ordinary reply text, never inside reasoning.
- Narration is a progress note, not the final answer: finish with a complete, standalone answer.
- The final answer carries conclusions, deliverables, and necessary instructions only; never restate the narration or your reasoning in it.
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
- 只写新增信息、避免空话；用普通段落，不写进思考内容；不要复述思考内容，最终回答不再重复过程。
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
- Only new information; no filler; plain paragraphs, never inside reasoning; do not restate reasoning, and the final answer does not repeat the narration.
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
      headerSub: 'Controls how the agent narrates between tool calls; changes apply from the next turn.',
      description:
        'Make the model narrate its progress in plain reply text between tool calls (detail level, sentence budget, language).',
      enabled: 'Enable interim narration',
      enabledHint: 'Off means the model writes no progress notes at all and only gives the final answer.',
      style: 'Narration detail',
      styleConcise: 'Concise (2 sentences)',
      styleStandard: 'Standard (3 sentences)',
      styleVerbose: 'Verbose (5 sentences)',
      contract: 'Prompt contract',
      contractFull: 'Full (explanatory)',
      contractCompact: 'Compact (same rules, fewer words)',
      contractHint: 'Both versions carry the same rules; Compact drops the examples and explanations, so the prompt is shorter.',
      previewTitle: 'Prompt preview',
      previewMeta: '{chars} characters · ~{tokens} tokens',
      previewNote: 'Exactly what the host injects for these settings. "Match the user" renders Chinese here; the real language follows the latest user message.',
      maxSentences: 'Sentences per note',
      minToolCalls: 'Skip the notes when the task needs at most',
      minToolCallsHint: 'If the task needs no more tool calls than this, the model may skip the progress notes and answer directly.',
      language: 'Prompt language',
      languageAuto: 'Auto (follow the language of your message)',
      languageZh: 'Chinese',
      languageEn: 'English',
      debug: 'Write debug log',
      debugHint: 'Writes start-up and setting-change lines to dsh-interim-narration.log in the DSH home; only useful when troubleshooting.',
      reportBlockers: 'Explain blockers first',
      reportBlockersHint: 'When a tool fails or the plan changes, it first tells you what happened and what it means, then adapts.',
      ackSteering: 'Acknowledge user interjections',
      ackSteeringHint: 'If you send a message while it is working, it answers you in one sentence first, then continues the original task.',
      announcePlan: 'Open with your understanding and plan',
      announcePlanHint: 'After each message from you, it first says how it reads your request, what it plans to do and where it starts, before calling any tool.',
      reminder: 'Add a short reminder at the end of the prompt',
      reminderHint: 'Repeats the same request in one short line at the end of the system prompt, so long tasks are less likely to forget it.',
      enforce: 'Escalate after a silent step',
      enforceHint: 'When a step calls a tool without any written note, the reminder for the next step becomes more explicit.',
      escalateAfter: 'Escalate after this many silent steps',
      escalateAfterHint: 'How many silent steps to allow. 1 = remind immediately after the first silent step; raise it to tolerate longer quiet stretches.',
      subagents: 'Subagent sessions',
      subagentsHint: 'Subagents are the helpers the main agent starts for parallel or delegated work.',
      subagentInherit: 'Narrate like the main agent',
      subagentSkip: 'Skip (main agent only)',
      styleHint: 'Concise / Standard / Verbose write 2 / 3 / 5 sentences by default; use "Sentences per note" below to fix a different number.',
      maxSentencesHint: '0 = use the number that comes with the preset; 1-10 fixes this number instead.',
      maxSentencesFollow: 'Following the preset: {count} sentences',
      sectionBasic: 'Basics',
      sectionPrompt: 'Opening and reminder',
      sectionAdvanced: 'Advanced',
      sectionDisplay: 'Display in the chat',
      navLabel: 'Interim narration',
      tabBasic: 'Basics',
      tabPrompt: 'Prompt',
      tabDisplay: 'Display',
      tabInterjection: 'Interjections',
      tabAdvanced: 'Advanced',
      versionCurrent: 'Installed version {version}',
      versionCheck: 'Check npm',
      versionChecking: 'Checking npm…',
      versionLatest: 'npm latest {version} — you are up to date',
      versionUpdate: 'npm latest {version} — update with: dsh plugin --profile desktop add dsh-interim-narration',
      versionFailed: 'Could not check npm: {message}',
      versionHint:
        'The copy inside the DSH profile is a plain copy; after an upgrade, reinstall it or switch to a link: install to avoid drift.',
      interjectionStale:
        'The patch was applied before, but this app.asar no longer carries it — most likely a DSH update. Enable it again below.',
      introBasic: 'How detailed the notes are, how long each one may be, and which language they use.',
      introPrompt: 'What it says at the start of a turn, whether to repeat the request at the end, and how it reacts when a step has no note.',
      introDisplay: 'Whether the process stays open or folds away in the chat. This does not change what the model writes.',
      introInterjection: 'What happens when you send a message while it is still working, plus an optional local fix.',
      introAdvanced: 'Two behaviour switches and one log switch for troubleshooting. You normally leave these alone.',
      interjectionExample:
        'Example: it is still looking things up and you add “check the price too”. Without the patch that turn stays unfolded forever; with the patch it folds when it finishes.',
      interjectionEffect:
        'The patch only changes whether an interjected turn folds. It does not change your message or any other turn.',
      resetField: 'Reset to default',
      resetAll: 'Reset all to defaults',
      resetPage: 'Reset this page',
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
      visibilityDescription: 'The narration is ordinary text inside a turn. These three settings decide whether the turn process stays open or folds away.',
      transcriptView: 'Work-step display',
      viewCompact: 'Compact',
      viewStandard: 'Standard',
      viewDetailed: 'Detailed',
      viewVerbose: 'Fully expanded',
      collapseTiming: 'Collapse work steps',
      collapseCompletion: 'After the answer finishes',
      collapseNextInput: 'On the next message',
      foldedReplies: 'Replies kept after collapse',
      repliesAll: 'All replies (keeps the narration)',
      repliesFinal: 'Final answer only',
      presetCollapse: 'Recommended: fold after the answer',
      presetCollapseHint: 'One click sets: Standard + fold after the answer + keep only the final answer.',
      presetExpand: 'Keep the process visible',
      presetExpandHint: 'One click sets: Detailed + fold only on your next message + keep all replies.',
      visibilitySaved: 'Display updated',
      visibilityFailed: 'The display setting was not accepted',
      visibilityUnavailable: 'The chat display settings are unavailable in this build.',
      visibilityNote: 'Same switches as Settings → General → Work-step display. Only clicking here changes them; the plugin never edits them by itself.',
      sectionInterjection: 'Mid-turn messages',
      interjectionDescription:
        'You can send a message while the agent is still working. By default that turn then stays expanded and never folds on its own. The optional patch below lets it fold normally when it finishes.',
      interjectionStatus: 'Status: {state}',
      interjectionPatched: 'enabled — restart DSH to load it',
      interjectionOriginal: 'not enabled',
      interjectionMixed: 'partially applied — revert, then enable again',
      interjectionUnknown: 'unrecognized build (DSH may have changed)',
      interjectionMissing: 'app.asar not found',
      interjectionEnable: 'Enable the patch',
      interjectionDisable: 'Revert to the original bundle',
      interjectionSaved: 'Patch written. Restart DSH for it to take effect.',
      interjectionReverted: 'Reverted. Restart DSH for it to take effect.',
      interjectionFailed: 'The patch could not be changed',
      interjectionUnavailable: 'This host did not expose the patch route (older DSH?).',
      interjectionNote:
        'Writes into the installed app.asar and keeps a backup beside it. A DSH update overwrites the patch; come back and enable it again afterwards. Only this machine is affected.',
      note: 'Saved values apply to the next reply. Order, fully custom prompt text and other install-time options still live in the profile Cordis patch.',
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
      headerSub: '控制 agent 在工具调用之间如何说明进展；保存后从下一轮生效。',
      description: '让模型在工具调用之间用正文说明进展（详细度、句数、语言等）。',
      enabled: '启用过程叙述',
      enabledHint: '关闭后模型完全不写过程说明，只给最终回答。',
      style: '叙述详细度',
      styleConcise: '简洁（2 句）',
      styleStandard: '标准（3 句）',
      styleVerbose: '详细（5 句）',
      contract: '提示词契约',
      contractFull: '完整（含解释）',
      contractCompact: '精简（规则相同、少解释）',
      contractHint: '两种写法规则一样；「精简」删掉举例和解释，提示词会短一些。',
      previewTitle: '提示词预览',
      previewMeta: '{chars} 字符 · 约 {tokens} tokens',
      previewNote: '与本设置下宿主实际注入的内容一致。「跟随用户语言」在这里按中文展示；真实语言跟随最近一条用户消息。',
      maxSentences: '每段最多句数',
      minToolCalls: '简单任务跳过叙述（需要调用的工具不超过）',
      minToolCallsHint: '如果完成任务需要调用的工具不超过这个数，模型可以跳过过程说明、直接给答案。',
      language: '提示词语言',
      languageAuto: '自动（跟随你消息的语言）',
      languageZh: '中文',
      languageEn: 'English',
      debug: '写入调试日志',
      debugHint: '把启动和配置变更记录写进 DSH 主目录的 dsh-interim-narration.log；只有排查问题时才需要打开。',
      reportBlockers: '遇到阻碍先说明',
      reportBlockersHint: '工具失败或计划要变时，先告诉你出了什么事、有什么影响，再说怎么调整。',
      ackSteering: '回应中途插话',
      ackSteeringHint: '你在它干活时插一句话，它会先回你一句，再接着做原来的事。',
      announcePlan: '开场先说理解与计划',
      announcePlanHint: '每次你发消息后，它先说明怎么理解你的要求、打算怎么做、第一步是什么，然后再开始调工具。',
      reminder: '在提示词末尾加一条提醒',
      reminderHint: '在系统提示末尾再放一小段同样的要求；任务很长时，模型不容易忘记叙述。',
      enforce: '静默后自动加压提醒',
      enforceHint: '发现某一步只调了工具、没有任何说明时，下一步的提醒会写得更明确。',
      escalateAfter: '连续静默几步后加压',
      escalateAfterHint: '连续静默多少步后开始加压。1 = 第一次没说明就提醒；调大可以容忍更长的安静期。',
      subagents: '子代理会话',
      subagentsHint: '子代理是主代理为并行或委派任务临时开的小助手。',
      subagentInherit: '和主代理一样叙述',
      subagentSkip: '跳过（只让主代理叙述）',
      styleHint: '「简洁／标准／详细」默认写 2／3／5 句；想固定句数，改下面的「每段最多句数」。',
      maxSentencesHint: '0 = 用档位自带的句数；填 1–10 则固定这个句数。',
      maxSentencesFollow: '跟随档位：{count} 句',
      sectionBasic: '基本',
      sectionPrompt: '开场与提醒',
      sectionAdvanced: '进阶',
      sectionDisplay: '聊天里的显示',
      navLabel: '过程叙述',
      tabBasic: '基本',
      tabPrompt: '提示词',
      tabDisplay: '显示',
      tabInterjection: '插话',
      tabAdvanced: '高级',
      versionCurrent: '当前安装版本 {version}',
      versionCheck: '检查 npm',
      versionChecking: '正在检查 npm…',
      versionLatest: 'npm 最新 {version}，已是最新',
      versionUpdate: 'npm 最新 {version}；升级：dsh plugin --profile desktop add dsh-interim-narration',
      versionFailed: '检查 npm 失败：{message}',
      versionHint: 'profile 里的插件是拷贝安装，升级后要重新装；用 link: 安装可以避免版本漂移。',
      interjectionStale:
        '之前打过补丁，但当前 app.asar 里没有补丁（多半是 DSH 更新过）。在下面重新启用即可。',
      introBasic: '决定过程说明写多细、每段多长、用哪种语言。',
      introPrompt: '决定每轮开头说什么、结尾要不要再提醒，以及模型偷懒时怎么加压。',
      introDisplay: '决定聊天里这些过程文字是收起还是留着；不影响模型实际怎么写。',
      introInterjection: '解释「你在它干活时插话」会发生什么，以及一个可选的修复补丁。',
      introAdvanced: '两个行为开关和一个排查用的日志开关，平时不用动。',
      interjectionExample:
        '例子：它正在查资料，你补一句「顺便看下价格」。没有补丁时，这一轮结束仍会摊开；有补丁时，结束后正常收起。',
      interjectionEffect: '补丁只改「被插话的轮次是否自动收起」，不影响你插的话，也不影响其他轮次。',
      resetField: '恢复默认',
      resetAll: '全部恢复默认',
      resetPage: '本页恢复默认',
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
      visibilityDescription: '过程叙述是回合里的普通文字。下面三项决定回合结束后，过程是收起还是留着。',
      transcriptView: '工作步骤展示',
      viewCompact: '简洁',
      viewStandard: '标准',
      viewDetailed: '详细（推荐）',
      viewVerbose: '完全展开',
      collapseTiming: '工作步骤收起时机',
      collapseCompletion: '回答结束后',
      collapseNextInput: '下次有新消息时',
      foldedReplies: '收起后显示的回复',
      repliesAll: '全部回复（保留过程叙述）',
      repliesFinal: '仅最终回答',
      presetCollapse: '推荐：回答结束后自动收起',
      presetCollapseHint: '一次设成：标准 + 回答结束就收起 + 只保留最终回答。',
      presetExpand: '全程展开过程',
      presetExpandHint: '一次设成：详细 + 下次发消息才收起 + 保留全部回复。',
      visibilitySaved: '显示设置已更新',
      visibilityFailed: '显示设置没有被接受',
      visibilityUnavailable: '当前版本读不到聊天显示设置。',
      visibilityNote: '与「设置 → 通用 → 工作步骤展示」是同一组开关；只有你在这里点才会改，插件不会自动改。',
      sectionInterjection: '轮次内插话',
      interjectionDescription:
        '你可以在 agent 还在干活时插话。默认情况下，被插话的这一轮会一直保持展开、不自动收起；打开下面的补丁后，它结束时会和其他轮次一样正常折叠。',
      interjectionStatus: '当前状态：{state}',
      interjectionPatched: '已启用 —— 重启 DSH 后生效',
      interjectionOriginal: '未启用',
      interjectionMixed: '只应用了一部分 —— 先还原，再重新启用',
      interjectionUnknown: '认不出这个版本（DSH 可能已更新）',
      interjectionMissing: '找不到 app.asar',
      interjectionEnable: '启用补丁',
      interjectionDisable: '还原为原始文件',
      interjectionSaved: '已写入补丁，重启 DSH 后生效。',
      interjectionReverted: '已还原，重启 DSH 后生效。',
      interjectionFailed: '补丁操作失败',
      interjectionUnavailable: '当前宿主没有提供补丁接口（DSH 版本较旧？）。',
      interjectionNote:
        '补丁直接写入已安装的 app.asar，并在旁边留备份。DSH 更新会覆盖它，更新后回来重新启用即可；只影响这台机器。',
      note: '保存后从下一轮开始生效。顺序、完全自定义提示词等安装时的选项，仍在 profile 的 Cordis patch 里改。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      discard: '撤销更改',
      unavailable: '该插件当前未加载，暂时无法配置。',
      saveFailed: '本部署没有接受这些值，已保留供你修改。',
    }

    /** Plain inline styles; colors come from the shell's alias tokens when present. */
    const S = {
      root: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 0 20px', width: '100%', maxWidth: '920px', margin: '0 auto' },
      // The sidebar panel host gives the panel a fixed height and does not
      // scroll it, so the page has to be its own scroll container there.
      panelRoot: {
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        width: '100%',
        maxWidth: '1040px',
        height: '100%',
        minHeight: 0,
        overflowY: 'auto',
        boxSizing: 'border-box',
        padding: '22px 26px 48px',
        margin: '0 auto',
      },
      header: {
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        padding: '18px 20px',
        borderRadius: '16px',
        border: '1px solid rgba(77, 107, 254, 0.16)',
        background: 'linear-gradient(135deg, rgba(77, 107, 254, 0.12), rgba(77, 107, 254, 0.03) 62%, rgba(77, 107, 254, 0))',
      },
      brandMark: {
        width: '40px',
        height: '40px',
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '12px',
        background: 'var(--dsw-alias-brand-primary, #4d6bfe)',
        color: '#fff',
        fontSize: '19px',
        lineHeight: 1,
        boxShadow: '0 6px 16px rgba(77, 107, 254, 0.28)',
      },
      headerText: { display: 'flex', flexDirection: 'column', gap: '3px', flex: '1 1 auto', minWidth: 0 },
      headerTitle: { fontSize: '16px', fontWeight: 700, letterSpacing: '0.2px', lineHeight: 1.35 },
      headerSub: { fontSize: '12px', lineHeight: 1.55, opacity: 0.62 },
      topbar: { display: 'flex', alignItems: 'center', gap: '10px' },
      versionBox: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '10px',
        padding: '12px 14px',
        border: '1px solid rgba(0, 0, 0, 0.08)',
        borderRadius: '12px',
        background: 'rgba(0, 0, 0, 0.015)',
      },
      versionText: { fontSize: '13px', fontWeight: 600 },
      intro: {
        fontSize: '12.5px',
        lineHeight: 1.65,
        padding: '9px 12px',
        borderRadius: '9px',
        background: 'rgba(77, 107, 254, 0.07)',
        color: 'inherit',
      },
      tabs: {
        display: 'flex',
        gap: '4px',
        padding: '4px',
        borderRadius: '12px',
        background: 'rgba(127, 127, 127, 0.08)',
        border: '1px solid rgba(127, 127, 127, 0.08)',
      },
      tabTrack: {
        display: 'flex',
        gap: '4px',
        padding: '4px',
        borderRadius: '12px',
        background: 'rgba(127, 127, 127, 0.08)',
        border: '1px solid rgba(127, 127, 127, 0.08)',
      },
      tab: {
        flex: '1 1 0',
        font: 'inherit',
        fontSize: '13.5px',
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: '9px',
        padding: '7px 12px',
        cursor: 'pointer',
        opacity: 0.62,
        color: 'inherit',
        transition: 'background 120ms ease, opacity 120ms ease',
      },
      tabActive: {
        flex: '1 1 0',
        font: 'inherit',
        fontSize: '13.5px',
        background: 'var(--dsw-alias-bg-primary, #fff)',
        border: '1px solid rgba(127, 127, 127, 0.12)',
        borderRadius: '9px',
        padding: '7px 12px',
        cursor: 'pointer',
        fontWeight: 600,
        color: 'var(--dsw-alias-brand-primary, #4d6bfe)',
        opacity: 1,
        boxShadow: '0 1px 3px rgba(16, 24, 40, 0.12)',
      },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0px',
        padding: '6px 22px 16px',
        borderRadius: '14px',
        border: '1px solid rgba(127, 127, 127, 0.14)',
        background: 'var(--dsw-alias-bg-primary, #ffffff)',
        boxShadow: '0 2px 10px rgba(16, 24, 40, 0.05)',
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '28px',
        padding: '14px 2px',
        borderBottom: '1px solid rgba(127, 127, 127, 0.10)',
      },
      rowText: { display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 auto', minWidth: 0 },
      label: { fontSize: '13.5px', fontWeight: 500, lineHeight: 1.4 },
      hint: { fontSize: '12px', lineHeight: 1.55, opacity: 0.58, maxWidth: '460px' },
      control: { flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', minWidth: '200px' },
      number: {
        width: '96px',
        height: '34px',
        padding: '0 10px',
        font: 'inherit',
        fontSize: '13px',
        textAlign: 'center',
        borderRadius: '9px',
        border: '1px solid rgba(127, 127, 127, 0.24)',
        background: 'var(--dsw-alias-bg-primary, #fff)',
        color: 'inherit',
        boxSizing: 'border-box',
        outline: 'none',
      },
      select: {
        minWidth: '200px',
        height: '34px',
        padding: '0 8px',
        font: 'inherit',
        fontSize: '13px',
        borderRadius: '9px',
        border: '1px solid rgba(127, 127, 127, 0.24)',
        background: 'var(--dsw-alias-bg-primary, #fff)',
        color: 'inherit',
        cursor: 'pointer',
        boxSizing: 'border-box',
        outline: 'none',
      },
      check: {
        width: '18px',
        height: '18px',
        accentColor: 'var(--dsw-alias-brand-primary, #4d6bfe)',
        cursor: 'pointer',
      },
      footer: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '16px 2px 0' },
      button: {
        font: 'inherit',
        fontSize: '13px',
        padding: '7px 16px',
        borderRadius: '9px',
        border: '1px solid rgba(127, 127, 127, 0.22)',
        background: 'var(--dsw-alias-bg-primary, #fff)',
        color: 'inherit',
        cursor: 'pointer',
      },
      buttonPrimary: {
        font: 'inherit',
        fontSize: '13px',
        padding: '7px 16px',
        borderRadius: '9px',
        border: '1px solid var(--dsw-alias-brand-primary, #4d6bfe)',
        background: 'var(--dsw-alias-brand-primary, #4d6bfe)',
        color: '#fff',
        fontWeight: 600,
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(77, 107, 254, 0.28)',
      },
      buttonDisabled: {
        font: 'inherit',
        fontSize: '13px',
        padding: '7px 16px',
        borderRadius: '9px',
        border: '1px solid rgba(127, 127, 127, 0.16)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'default',
        opacity: 0.45,
      },
      reset: {
        font: 'inherit',
        width: '28px',
        height: '28px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        borderRadius: '8px',
        border: '1px solid transparent',
        background: 'transparent',
        color: 'inherit',
        fontSize: '14px',
        cursor: 'pointer',
        opacity: 0.45,
      },
      status: {
        fontSize: '12px',
        color: 'var(--dsw-alias-green-6, #1f9d55)',
        background: 'rgba(31, 157, 85, 0.10)',
        padding: '3px 10px',
        borderRadius: '999px',
      },
      error: {
        fontSize: '12px',
        lineHeight: 1.6,
        color: 'var(--dsw-alias-red-6, #d4380d)',
        background: 'rgba(212, 56, 13, 0.07)',
        padding: '9px 12px',
        borderRadius: '9px',
        whiteSpace: 'pre-wrap',
      },
      section: { display: 'flex', flexDirection: 'column', gap: '12px' },
      sectionHead: { display: 'flex', flexDirection: 'column', gap: '3px', paddingTop: '14px' },
      sectionTitle: { fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', opacity: 0.5 },
      preview: {
        margin: 0,
        padding: '12px 14px',
        maxHeight: '280px',
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        fontSize: '12px',
        lineHeight: 1.65,
        fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)',
        background: 'rgba(127, 127, 127, 0.06)',
        border: '1px solid rgba(127, 127, 127, 0.12)',
        borderRadius: '10px',
      },
      note: { fontSize: '11.5px', lineHeight: 1.6, opacity: 0.55, padding: '0 2px' },
      cardHead: { display: 'flex', flexDirection: 'column', gap: '3px', paddingTop: '14px' },
      cardTitle: { fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', opacity: 0.5 },
      cardHint: { fontSize: '12px', lineHeight: 1.6, opacity: 0.58 },
      panel: { display: 'flex', flexDirection: 'column', gap: '14px' },
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
          style: S.check,
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
      const pair = id === 'display-visible' ? ['detailed', 'next-input', 'all'] : ['compact', 'completion', 'final']
      const write = () =>
        chatScope.mutate(
          [
            { op: 'set', path: ['transcriptView'], value: pair[0] },
            { op: 'set', path: ['collapseTiming'], value: pair[1] },
            { op: 'set', path: ['foldedReplies'], value: pair[2] },
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

    /** Small outline icon used by the sidebar entry. */
    function SidebarIcon(props) {
      const size = props?.size ?? 16
      return react.createElement(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          'aria-hidden': 'true',
        },
        react.createElement('path', { d: 'M3 2.5h7l3 3v8H3z' }),
        react.createElement('path', { d: 'M6 7.5h4M6 10.5h4' }),
      )
    }

    /** The settings page itself. */
    function NarrationSettingsPage(props) {
      const t = props.t ?? ((key) => key)
      const surface = props.surface
      const scope = props.scope
      const [snapshot, setSnapshot] = react.useState(() => readSnapshot(scope))
      const [draft, setDraft] = react.useState(() => ({ ...DEFAULTS, ...(readSnapshot(scope).value ?? {}) }))
      const [status, setStatus] = react.useState(null)
      const [activeTab, setActiveTab] = react.useState('basic')
      // Installed version is compiled in; the npm comparison runs on demand.
      const [updateState, setUpdateState] = react.useState({ kind: 'idle' })

      // Chat display settings are a second, independent namespace. This block
      // only exists because the narration is useless if the process is folded
      // away; it still writes only when the user clicks a control.
      const chatScope = props.chatScope ?? null
      const [chatSnapshot, setChatSnapshot] = react.useState(() => readSnapshot(chatScope))
      const [chatStatus, setChatStatus] = react.useState(null)

      // Local ui-chat fold patch: the host half owns the file operation, this
      // page only reads the status and asks for apply/revert.
      const [foldStatus, setFoldStatus] = react.useState(null)
      const [foldNotice, setFoldNotice] = react.useState(null)

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

      // Read the patch status once; a failed fetch just hides the state label.
      react.useEffect(() => {
        let cancelled = false
        const load = async () => {
          if (typeof fetch !== 'function') return
          try {
            const response = await fetch(FOLD_PATCH_ROUTE, { headers: { accept: 'application/json' } })
            const data = await response.json()
            if (!cancelled) setFoldStatus(data)
          } catch {
            if (!cancelled) setFoldNotice({ kind: 'error', message: t('interjectionUnavailable') })
          }
        }
        load()
        return () => {
          cancelled = true
        }
      }, [])

      /** Apply or revert the local ui-chat patch through the host route. */
      const runFoldPatch = async (action) => {
        if (typeof fetch !== 'function') return
        setFoldNotice({ kind: 'saving' })
        try {
          const response = await fetch(FOLD_PATCH_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action }),
          })
          const data = await response.json()
          if (!data || data.ok !== true) throw new Error(data?.error ?? 'failed')
          setFoldStatus(data)
          setFoldNotice({ kind: action === 'apply' ? 'saved' : 'reverted' })
        } catch (error) {
          setFoldNotice({
            kind: 'error',
            message: error && error.message ? error.message : String(error),
          })
        }
      }

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
      const replyLabels = {
        all: t('repliesAll'),
        final: t('repliesFinal'),
      }
      const currentChat = `${t('visibilityCurrent')}: ${
        viewLabels[chatValue.transcriptView] ?? chatValue.transcriptView ?? '—'
      } · ${collapseLabels[chatValue.collapseTiming] ?? chatValue.collapseTiming ?? '—'} · ${
        replyLabels[chatValue.foldedReplies] ?? chatValue.foldedReplies ?? '—'
      }`

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

      /** One button per display combination: folded after the answer by default. */
      const applyDisplayPreset = (transcriptView, collapseTiming, foldedReplies) =>
        commitChat([
          { op: 'set', path: ['transcriptView'], value: transcriptView },
          { op: 'set', path: ['collapseTiming'], value: collapseTiming },
          { op: 'set', path: ['foldedReplies'], value: foldedReplies },
        ])

      const applyCollapsePreset = () => applyDisplayPreset('standard', 'completion', 'final')
      const applyExpandPreset = () => applyDisplayPreset('detailed', 'next-input', 'all')

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
      const resetTab = async (tabId) => {
        if (disabled) return
        if (tabId === 'display') {
          if (chatScope === null) return
          try {
            await commitChat(
              Object.keys(CHAT_DEFAULTS).map((key) => ({ op: 'set', path: [key], value: CHAT_DEFAULTS[key] })),
            )
          } catch {
            // commitChat already surfaces the failure through its notice state.
          }
          return
        }
        const keys = TAB_FIELDS[tabId]
        if (keys !== undefined) await applyReset(keys)
      }
      const pageReset = (tabId) =>
        react.createElement(
          'div',
          { style: S.footer },
          react.createElement(
            'button',
            {
              type: 'button',
              style: S.button,
              disabled: disabled || status?.kind === 'saving',
              onClick: () => resetTab(tabId),
            },
            t('resetPage'),
          ),
        )
      const resetFor = (key) => resetButton(t, key, resetField, disabled)

      // The page is grouped into scannable blocks. `maxSentences` 0 means
      // "follow the detail preset", so its hint shows the budget that preset
      // allows right now (the host applies the same rule).
      const styleBudget = STYLE_BUDGET[draft.style] ?? STYLE_BUDGET.standard
      const maxSentencesHint =
        draft.maxSentences === 0
          ? t('maxSentencesFollow').replace('{count}', String(styleBudget))
          : t('maxSentencesHint')

      const checkUpdate = async () => {
        setUpdateState({ kind: 'checking' })
        try {
          const response = await fetch('/dsh-interim-narration/meta?refresh=1')
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json()
          setUpdateState({ kind: 'done', latest: payload.latest, error: payload.error })
        } catch (error) {
          setUpdateState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
        }
      }

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
        selectRow(
          t,
          draft,
          setField,
          'subagents',
          t('subagents'),
          t('subagentsHint'),
          disabled,
          [
            ['inherit', t('subagentInherit')],
            ['skip', t('subagentSkip')],
          ],
          resetFor('subagents'),
        ),
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
        selectRow(t, chatValue, setVisibility, 'foldedReplies', t('foldedReplies'), null, chatDisabled, [
          ['all', t('repliesAll')],
          ['final', t('repliesFinal')],
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
              onClick: applyCollapsePreset,
            },
            t('presetCollapse'),
          ),
          react.createElement(
            'button',
            {
              type: 'button',
              style: chatDisabled ? S.buttonDisabled : S.button,
              disabled: chatDisabled || chatStatus?.kind === 'saving',
              onClick: applyExpandPreset,
            },
            t('presetExpand'),
          ),
          chatStatus?.kind === 'saving' ? react.createElement('span', { style: S.status }, t('saving')) : null,
          chatStatus?.kind === 'saved' ? react.createElement('span', { style: S.status }, t('visibilitySaved')) : null,
          chatStatus?.kind === 'error'
            ? react.createElement('span', { style: S.error }, `${t('visibilityFailed')}\n${chatStatus.message}`)
            : null,
        ),
        react.createElement('div', { style: S.note }, t('presetCollapseHint')),
        react.createElement('div', { style: S.note }, t('presetExpandHint')),
        react.createElement('div', { style: S.note }, t('visibilityNote')),
      )

      const foldState = foldStatus?.state
      const foldStateText =
        foldStatus?.stale === true
          ? t('interjectionStale')
          : foldState === 'patched'
          ? t('interjectionPatched')
          : foldState === 'original'
            ? t('interjectionOriginal')
            : foldState === 'mixed'
              ? t('interjectionMixed')
              : foldState === 'missing'
                ? t('interjectionMissing')
                : foldState === 'unknown'
                  ? t('interjectionUnknown')
                  : '—'
      const foldBusy = foldNotice?.kind === 'saving'
      const interjection = react.createElement(
        'div',
        { key: 'interjection', style: S.section },
        react.createElement(
          'div',
          { style: S.sectionHead },
          react.createElement('div', { style: S.sectionTitle }, t('sectionInterjection')),
          react.createElement('div', { style: S.hint }, t('interjectionDescription')),
        ),
        react.createElement('div', { style: S.note }, t('interjectionExample')),
        react.createElement('div', { style: S.note }, t('interjectionEffect')),
        react.createElement(
          'div',
          { style: S.note },
          t('interjectionStatus').replace('{state}', foldStateText),
        ),
        foldNotice?.kind === 'saved' ? react.createElement('div', { style: S.status }, t('interjectionSaved')) : null,
        foldNotice?.kind === 'reverted'
          ? react.createElement('div', { style: S.status }, t('interjectionReverted'))
          : null,
        foldNotice?.kind === 'error'
          ? react.createElement('div', { style: S.error }, `${t('interjectionFailed')}\n${foldNotice.message ?? ''}`)
          : null,
        react.createElement(
          'div',
          { style: S.footer },
          react.createElement(
            'button',
            {
              type: 'button',
              style: S.button,
              disabled:
                foldBusy ||
                foldState === 'patched' ||
                foldState === 'missing' ||
                foldState === 'unknown',
              onClick: () => runFoldPatch('apply'),
            },
            t('interjectionEnable'),
          ),
          react.createElement(
            'button',
            {
              type: 'button',
              style: S.button,
              disabled:
                foldBusy || foldState === 'original' || foldState === 'missing' || foldState === 'unknown',
              onClick: () => runFoldPatch('revert'),
            },
            t('interjectionDisable'),
          ),
        ),
        react.createElement('div', { style: S.note }, t('interjectionNote')),
      )

      const footer = react.createElement(
        'div',
        { style: S.footer },
        react.createElement(
          'button',
          {
            type: 'button',
            style: dirty && !disabled ? S.buttonPrimary : S.buttonDisabled,
            disabled: !dirty || disabled || status?.kind === 'saving',
            onClick: save,
          },
          status?.kind === 'saving' ? t('saving') : t('save'),
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

      // Horizontal tabs keep the page short. Every panel stays mounted (only
      // the inactive ones are display:none) so the preview and the fold status
      // keep updating while another tab is open.
      const intro = (key) => react.createElement('div', { style: S.intro }, t(key))
      const tabs = [
        { id: 'basic', label: t('tabBasic'), content: [intro('introBasic'), ...basicElements, pageReset('basic')] },
        { id: 'prompt', label: t('tabPrompt'), content: [intro('introPrompt'), ...promptElements, previewBlock, pageReset('prompt')] },
        { id: 'display', label: t('tabDisplay'), content: [intro('introDisplay'), visibility, pageReset('display')] },
        { id: 'interjection', label: t('tabInterjection'), content: [intro('introInterjection'), interjection] },
        { id: 'advanced', label: t('tabAdvanced'), content: [intro('introAdvanced'), ...advancedElements, pageReset('advanced')] },
      ]

      const updateText =
        updateState.kind === 'checking'
          ? t('versionChecking')
          : updateState.kind === 'failed'
            ? t('versionFailed').replace('{message}', updateState.message ?? '')
            : updateState.kind === 'done' && updateState.latest !== null
              ? updateState.latest === PLUGIN_VERSION
                ? t('versionLatest').replace('{version}', updateState.latest)
                : t('versionUpdate').replace('{version}', updateState.latest)
              : updateState.kind === 'done'
                ? t('versionFailed').replace('{message}', updateState.error ?? '—')
                : ''
      const versionBlock = react.createElement(
        'div',
        { key: 'version', style: S.versionBox },
        react.createElement(
          'div',
          { style: S.versionText },
          t('versionCurrent').replace('{version}', PLUGIN_VERSION),
        ),
        react.createElement(
          'button',
          {
            type: 'button',
            style: S.button,
            disabled: disabled || updateState.kind === 'checking',
            onClick: checkUpdate,
          },
          t('versionCheck'),
        ),
        updateText === '' ? null : react.createElement('div', { style: S.note }, updateText),
        react.createElement('div', { style: S.note }, t('versionHint')),
      )

      return react.createElement(
        'div',
        { style: surface === 'panel' ? S.panelRoot : S.root },
        disabled ? react.createElement('div', { style: S.error }, t('unavailable')) : null,
        react.createElement(
          'div',
          { style: S.header },
          react.createElement('div', { style: S.brandMark }, '✎'),
          react.createElement(
            'div',
            { style: S.headerText },
            react.createElement('div', { style: S.headerTitle }, t('title')),
            react.createElement('div', { style: S.headerSub }, t('headerSub')),
          ),
          react.createElement(
            'button',
            {
              type: 'button',
              style: S.button,
              disabled: disabled || status?.kind === 'saving',
              onClick: resetAll,
            },
            t('resetAll'),
          ),
        ),
        react.createElement(
          'div',
          { style: S.tabTrack },
          ...tabs.map((tab) =>
            react.createElement(
              'button',
              {
                key: `tab-${tab.id}`,
                type: 'button',
                style: activeTab === tab.id ? S.tabActive : S.tab,
                onClick: () => setActiveTab(tab.id),
              },
              tab.label,
            ),
          ),
        ),
        ...tabs.map((tab) =>
          react.createElement(
            'div',
            { key: `panel-${tab.id}`, style: activeTab === tab.id ? S.card : { display: 'none' } },
            ...tab.content,
          ),
        ),
        footer,
        versionBlock,
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

      // Also expose the same page as a top-level Settings section, so the whole
      // configuration lives under 设置 → 过程叙述 next to the host's own pages.
      // The Plugins page keeps its 配置 button as a shortcut.
      ctx.effect(
        () =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'interim-narration',
                order: 22,
                label: () => t('title'),
                locale: LOCALE_NS,
              },
              (props) => react.createElement(NarrationSettingsPage, { ...props, t, scope, chatScope }),
            ),
          ),
        'interim-narration: settings section',
      )

      // Optional sidebar entry: the Host selects the "main" panel keyed by the
      // same id when the row is clicked. Guarded by slots.inject so a Host
      // without a sidebar simply keeps the Settings section.
      ctx.effect(
        () =>
          ctx.slots.inject('main', () =>
            ctx.slots.register(
              { name: 'main', key: PANEL_ID, locale: LOCALE_NS, inject: () => ({ t }) },
              (props) =>
                react.createElement(NarrationSettingsPage, { ...props, t, scope, chatScope, surface: 'panel' }),
            ),
          ),
        'interim-narration: sidebar panel',
      )
      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: 60,
                label: () => t('navLabel'),
                locale: LOCALE_NS,
              },
              (owner = {}) => react.createElement(SidebarIcon, { size: owner.size ?? 16 }),
            ),
          ),
        'interim-narration: sidebar entry',
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
    exports.__version = PLUGIN_VERSION
    return module.exports
  },
})
