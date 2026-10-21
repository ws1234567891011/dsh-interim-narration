# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.5.x | ✅ |
| 0.4.x | ✅ |
| < 0.4 | ⚠️ upgrade recommended |

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Report privately via GitHub's
[Security advisory](https://github.com/ws1234567891011/dsh-interim-narration/security/advisories/new)
form. You can expect an initial reply within a few days.

## What this plugin can and cannot do

- It registers **prompt sections** only. It does not register tools, does not execute commands,
  does not read conversation content and does not write to sessions.
- The optional enforcement state machine subscribes to `session/event` **read-only**; it keeps an
  in-memory per-session counter and never persists or transmits it.
- Debug logging writes a local file (default `~/.dsh/dsh-interim-narration.log`) containing the
  plugin's own prompt text and counters — no user messages, no credentials.
- The in-app settings page writes only through the host `configForms` / `settings` services, into the
  current profile's `cordis.patch.yml`. It never touches other namespaces except the Chat display
  controls, which it writes only when the user clicks them.
- No network access, no runtime dependencies.
