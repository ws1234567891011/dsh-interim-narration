#!/usr/bin/env node
// Turn the CHANGELOG section for a release into the GitHub Release body.
// The release workflow calls this with the tag, so every release page carries
// the same declaration the CHANGELOG and the package version point at.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const rawTag = (process.argv[2] ?? '').replace(/^refs\/tags\//, '').trim()
const version = (rawTag || `v${packageJson.version}`).replace(/^v/, '')

function fail(message) {
  console.error(`release-notes: FAILED — ${message}`)
  process.exit(1)
}

if (version !== packageJson.version) {
  fail(`tag v${version} does not match package.json version ${packageJson.version}`)
}

const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8')
const heading = `## ${version}`
const start = changelog.indexOf(heading)
if (start === -1) fail(`CHANGELOG.md has no "${heading}" section`)
if (start > 0 && changelog[start - 1] !== '\n') fail(`"${heading}" must start its own line`)

const rest = changelog.slice(start + heading.length)
const next = rest.search(/\n## /)
const section = (next === -1 ? rest : rest.slice(0, next)).trim()
if (section === '') fail(`"${heading}" section is empty`)
if (!section.includes('- ')) fail(`"${heading}" section has no bullet entries`)

const body = `${section}

---

安装：\`dsh plugin --profile desktop add dsh-interim-narration\`

版本与发布规则见 [VERSIONING.md](VERSIONING.md)；npm 上的同一版本：https://www.npmjs.com/package/dsh-interim-narration/v/${version}
`

writeFileSync(resolve(root, 'release-notes.md'), body, 'utf8')
console.log(`release-notes: OK — v${version}, ${section.split('\n').filter((line) => line.startsWith('- ')).length} entries, ${body.length} characters`)
