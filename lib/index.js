/**
 * dsh-interim-narration — host half.
 *
 * Registers one system-prompt section that asks the model to narrate its work in
 * ordinary reply text between tool batches, and exposes the user-facing knobs
 * through a schemastery `Config` so DSH's settings surface (Plugins page → this
 * plugin's row → 配置) can edit them without touching YAML or code.
 *
 * The editable fields are declared `.volatile()`: the loader resolves them into
 * in-place references, so a settings save updates the next prompt assembly
 * without re-mounting the plugin. The prompt section renders its body from a
 * function (see ./core.js), not from a frozen string.
 *
 * The root `.default({})` keeps the resolved config an object even when the row
 * carries no `config` key at all — without it the loader would have no volatile
 * references to update.
 *
 * @module dsh-interim-narration
 */

import z from '@deepseek-ai/schemastery'

import {
  DEFAULT_CONTRACT,
  DEFAULT_ESCALATE_AFTER,
  DEFAULT_ENFORCE,
  DEFAULT_MAX_SENTENCES,
  DEFAULT_MIN_TOOL_CALLS,
  DEFAULT_ORDER,
  DEFAULT_STYLE,
} from './core.js'

export {
  CONTRACTS,
  DEFAULT_ANNOUNCE_PLAN,
  DEFAULT_CONTRACT,
  DEFAULT_ENFORCE,
  DEFAULT_ESCALATE_AFTER,
  DEFAULT_MAX_SENTENCES,
  DEFAULT_MIN_TOOL_CALLS,
  DEFAULT_ORDER,
  DEFAULT_REMINDER,
  DEFAULT_REMINDER_ORDER,
  DEFAULT_STYLE,
  LANGUAGES,
  MAX_TRACKED_SESSIONS,
  REMINDER_SECTION_NAME,
  MAX_LOG_BYTES,
  PLUGIN,
  SECTION_NAME,
  STYLES,
  STYLE_SENTENCES,
  analyzeAssistantMessage,
  analyzeUserMessage,
  apply,
  appendLog,
  buildBuiltInText,
  buildPreview,
  buildReminderText,
  buildSectionText,
  createNarrationTracker,
  defaultLogFile,
  detectLanguage,
  resolveLanguage,
  enCompact,
  enReminder,
  enText,
  enEscalation,
  inject,
  name,
  plainValues,
  resolveConfig,
  zhCompact,
  zhReminder,
  zhEscalation,
  zhText,
} from './core.js'

/**
 * Plugin config.
 *
 * The first block is what the settings page can edit: every field is
 * `.volatile()` so a save lands in the running fiber instead of requiring a
 * plugin reload. The second block is install-time tuning that stays in the
 * profile patch (`order`, an override `text`, extra `text`, log location).
 */
export const Config = z
  .object({
    // ── Editable from the settings page ────────────────────────────────────
    enabled: z.boolean().default(true).volatile(),
    style: z.string().default(DEFAULT_STYLE).volatile(),
    // `full` = explanatory contract, `compact` = same rules with less prose.
    contract: z.string().default(DEFAULT_CONTRACT).volatile(),
    // 0 = follow the style budget (concise 2 / standard 3 / verbose 5).
    maxSentences: z.number().step(1).min(0).max(10).default(0).volatile(),
    minToolCalls: z.number().step(1).min(0).max(10).default(DEFAULT_MIN_TOOL_CALLS).volatile(),
    language: z.string().default('auto').volatile(),
    debug: z.boolean().default(false).volatile(),
    reportBlockers: z.boolean().default(true).volatile(),
    ackSteering: z.boolean().default(true).volatile(),
    announcePlan: z.boolean().default(true).volatile(),
    reminder: z.boolean().default(true).volatile(),
    enforce: z.boolean().default(DEFAULT_ENFORCE).volatile(),
    escalateAfter: z.number().step(1).min(1).max(5).default(DEFAULT_ESCALATE_AFTER).volatile(),
    // ── Install-time only (patch editing; reload to apply) ─────────────────
    order: z.number().default(DEFAULT_ORDER),
    text: z.string().default(''),
    extra: z.string().default(''),
    logFile: z.string().default(''),
  })
  .default({})
