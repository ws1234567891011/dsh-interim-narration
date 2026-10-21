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
        toggleRow(t, draft, setField, 'debug', t('debug'), t('debugHint'), disabled),
      ]

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
                    : react.createElement(NarrationSettingsPage, { ...props, t, scope }),
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
