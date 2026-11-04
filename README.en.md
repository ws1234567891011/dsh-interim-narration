# dsh-interim-narration

[![CI](https://github.com/ws1234567891011/dsh-interim-narration/actions/workflows/ci.yml/badge.svg)](https://github.com/ws1234567891011/dsh-interim-narration/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![npm](https://img.shields.io/npm/v/dsh-interim-narration.svg)](https://www.npmjs.com/package/dsh-interim-narration)

**English** | [简体中文](README.md)

This plugin makes the agent in DeepSeek Harness talk while it works. Every turn it opens with a sentence or two about how it reads your message and what it is about to do, then drops a short note after each batch of tool calls, instead of quietly chaining tools and dumping one big answer at the end.

It looks roughly like this (together with the chat's "work steps" setting):

```
I'll split these files by type first: PDFs get converted, Word files convert directly, images last.
  [read 12 files] [ran a command]
Three of them are scans — the text will need manual checking, so I'm setting those aside. The other nine convert cleanly.
  [edited a file]
```

Those paragraphs are process commentary for you, not the model's raw chain-of-thought; the private reasoning stays in its own "thinking" block.

## Screenshots

![Plugin settings page](docs/images/settings-page.png)

The page has four blocks — Basics, Opening and reminder, Advanced, Display in the chat — plus a live prompt preview showing the exact text the host injects, its character count and an estimated token count.

What the narration looks like in the chat (illustrative, colours follow your theme):

![Narration example](docs/images/narration-example.png)

The row in the plugin list:

![Plugin row](docs/images/plugin-row.png)

## Install

```bash
# npm
dsh plugin --profile desktop add dsh-interim-narration
```

Or install a local checkout (`link:` follows your source edits, `file:` copies it):

```bash
dsh plugin --profile desktop add link:C:/path/to/dsh-interim-narration
```

Refresh the page afterwards (Ctrl+R). The plugin shows up in the sidebar's Plugins page with a Configure button; if it doesn't, restart DSH once.

## Tuning

Open Plugins → `dsh-interim-narration` → Configure. Saving takes effect on the next turn, no restart needed.

The fields you'll actually touch:

| Field | Default | What it does |
| --- | --- | --- |
| `enabled` | on | Turning it off empties the prompt section; the plugin stays mounted |
| `style` | standard | How much it talks: concise 2 / standard 3 / verbose 5 sentences |
| `contract` | full | Switch to compact to save about 59% of the contract characters; same rules, fewer explanations |
| `maxSentences` | 0 | 0 follows the `style` budget; 1–10 pins it |
| `language` | auto | Follows the language of your last message; can be pinned to Chinese or English |
| `announcePlan` | on | Opens each turn with understanding and plan |
| `enforce` | on | If a tool step had no narration, the next reminder gets sharper |
| `escalateAfter` | 1 | How many silent steps before it gets sharper; 1 is the most eager |

`order`, `text`, `extra` and `logFile` are install-time options — edit `cordis.patch.yml` in your profile for those.

Just want to see it? The button at the bottom of the settings page ("recommended: keep the process visible") sets the chat to detailed + keep-open-until-next-message. It writes only when you click it, and never touches your settings on its own.

## Why can't I see it sometimes

1. **The chat folded it.** The default compact/standard modes collapse finished turns into "done, took 3m · 9 tool calls". Click that row, or use the button above.
2. **It actually didn't narrate.** Models forget when they get busy. The plugin puts a short reminder at the end of the system prompt, and sharpens it after silent steps (`enforce`, `escalateAfter`).
3. **You want to spend fewer tokens.** Switch `contract` to compact or lower `style`.

## What it actually changes

One thing: it registers two pieces of text in the system prompt — a full description of the working convention (when to speak, what to say, how) and a short reminder at the end.

No tools, no session writes, no faked messages, no network calls, no runtime dependencies. Everything comes from the prompt, so the ceiling is "the model is more willing to narrate" — it can't force it.

## Cache impact

The plugin doesn't cache anything and doesn't touch host caches; it edits the system prompt, which does affect server-side prefix caching:

- The main contract is static while your settings don't change: paid once, then cached.
- The end-of-prompt reminder is dynamic: a silent step adds a line. Since 0.7.0 that line stays identical for the rest of the turn, so the prefix changes once when it appears and once when it clears, not on every step.
- `language: auto` is decided once per turn from the first user message, so it doesn't flip back and forth.
- Changing settings invalidates the next turn's prefix once, which is expected.

To maximise cache hits: pin the language, turn `enforce` off when you don't need the safety net, and avoid editing settings in the middle of a conversation.

## Compatibility

- DSH `0.2.x` (verified on 0.2.1-rc.2 and 0.2.1-rc.3). `package.json` declares a machine-readable `dsh.engines.dsh`, which the plugin manager checks before install.
- Needs the host `systemPrompt` service. The settings page needs the settings services (`configForms` + `plugins.row.config`). The `/narration` command needs `commandUi` and is skipped when absent.
- Without the `session/event` stream, silent-step escalation and automatic language follow degrade to static behaviour; everything else still works.

## Development

```bash
npm test            # host logic + client bundle + package manifest
npm run test:e2e    # one real headless DSH run against a local mock model (~6s)
```

`test/e2e.mjs` finds a local DSH install on its own and prints `SKIPPED` when there isn't one, so CI and machines without DSH can still run it. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Uninstall

```bash
dsh plugin --profile desktop remove dsh-interim-narration
```

## License

[MIT](LICENSE) © 2026 ws1234567891011
