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

    /** Dictionary namespace owned by this plugin. */
    const LOCALE_NS = 'interimNarration'

    /** Fields the settings page edits (all `.volatile()` in the host schema). */
    const EDITABLE = [
      'enabled',
      'style',
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

    /** Render a text/control row. */
    function row(t, key, label, hint, control) {
      return react.createElement(
        'div',
        { key, style: S.row },
        react.createElement(
          'div',
          { style: S.rowText },
          react.createElement('div', { style: S.label }, label),
          hint ? react.createElement('div', { style: S.hint }, hint) : null,
        ),
        react.createElement('div', { style: S.control }, control),
      )
    }

    /** One checkbox row. */
    function toggleRow(t, draft, setField, key, label, hint, disabled) {
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
      )
    }

    /** One select row. */
    function selectRow(t, draft, setField, key, label, hint, disabled, options) {
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
      )
    }

    /** One numeric row. */
    function numberRow(t, draft, setField, key, label, hint, disabled, min, max) {
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
      )
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

      const elements = [
        selectRow(t, draft, setField, 'style', t('style'), null, disabled, [
          ['concise', t('styleConcise')],
          ['standard', t('styleStandard')],
          ['verbose', t('styleVerbose')],
        ]),
        numberRow(t, draft, setField, 'maxSentences', t('maxSentences'), t('maxSentencesHint'), disabled, 1, 10),
        numberRow(t, draft, setField, 'minToolCalls', t('minToolCalls'), t('minToolCallsHint'), disabled, 0, 10),
        selectRow(t, draft, setField, 'language', t('language'), null, disabled, [
          ['auto', t('languageAuto')],
          ['zh', t('languageZh')],
          ['en', t('languageEn')],
        ]),
        toggleRow(t, draft, setField, 'enabled', t('enabled'), t('enabledHint'), disabled),
        toggleRow(t, draft, setField, 'reportBlockers', t('reportBlockers'), t('reportBlockersHint'), disabled),
        toggleRow(t, draft, setField, 'ackSteering', t('ackSteering'), t('ackSteeringHint'), disabled),
        toggleRow(t, draft, setField, 'announcePlan', t('announcePlan'), t('announcePlanHint'), disabled),
        toggleRow(t, draft, setField, 'reminder', t('reminder'), t('reminderHint'), disabled),
        toggleRow(t, draft, setField, 'enforce', t('enforce'), t('enforceHint'), disabled),
        numberRow(t, draft, setField, 'escalateAfter', t('escalateAfter'), t('escalateAfterHint'), disabled, 1, 5),
        toggleRow(t, draft, setField, 'debug', t('debug'), t('debugHint'), disabled),
      ]

      const visibility = react.createElement(
        'div',
        { key: 'visibility', style: S.section },
        react.createElement(
          'div',
          { style: S.sectionHead },
          react.createElement('div', { style: S.sectionTitle }, t('visibilityTitle')),
          react.createElement('div', { style: S.hint }, t('visibilityDescription')),
        ),
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
        ...elements,
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
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
