#!/usr/bin/env node
/**
 * Release declaration gate.
 *
 * Every release must be declared where people look for it: a version in
 * package.json, a non-empty section for that exact version in CHANGELOG.md,
 * and a machine-checkable host compatibility range. The release workflow runs
 * this before it publishes anything, so a tag without a declaration cannot
 * ship.
 *
 * Usage:
 *   node test/release-check.mjs            # check the current version
 *   node test/release-check.mjs v1.0.0     # also require tag == version
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')

const rawTag = (process.argv[2] ?? '').trim()
const tagVersion = rawTag.startsWith('v') ? rawTag.slice(1) : rawTag
const problems = []

if (tagVersion !== '' && tagVersion !== pkg.version) {
  problems.push(`tag "${rawTag}" points at ${tagVersion}, but package.json says ${pkg.version}`)
}
if (!pkg.dsh?.engines?.dsh) {
  problems.push('package.json is missing dsh.engines.dsh (the host compatibility declaration)')
}

const lines = changelog.split(/\r?\n/u)
const headingIndex = lines.findIndex((line) => line.trim() === `## ${pkg.version}`)
if (headingIndex < 0) {
  problems.push(`CHANGELOG.md has no "## ${pkg.version}" section — every release needs a declaration`)
}
let declaration = []
if (headingIndex >= 0) {
  let end = lines.length
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (/^##\s/u.test(lines[i])) {
      end = i
      break
    }
  }
  declaration = lines.slice(headingIndex + 1, end).map((line) => line.trim()).filter(Boolean)
  const bullets = declaration.filter((line) => line.startsWith('- ') || line.startsWith('* '))
  if (bullets.length === 0) {
    problems.push(`the "## ${pkg.version}" section has no bullet points; say what changed and what users must do`)
  }
  if (declaration.join(' ').length < 40) {
    problems.push(`the "## ${pkg.version}" section is too short to count as a declaration`)
  }
}

if (problems.length > 0) {
  console.error('release-check: FAILED')
  for (const problem of problems) console.error(` - ${problem}`)
  console.error('\nWrite the declaration in CHANGELOG.md, then tag again.')
  process.exit(1)
}

console.log(`release-check: OK`)
console.log(`  version: ${pkg.version}`)
console.log(`  host:    dsh ${pkg.dsh.engines.dsh} · node ${pkg.engines?.node ?? 'n/a'}`)
if (tagVersion !== '') console.log(`  tag:     ${rawTag}`)
console.log('  declaration:')
for (const line of declaration.slice(0, 6)) console.log(`    ${line}`)
if (declaration.length > 6) console.log(`    … ${declaration.length - 6} more line(s) in CHANGELOG.md`)
