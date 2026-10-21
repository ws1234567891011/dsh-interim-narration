// Verify that `npm pack` ships exactly the files the plugin needs at runtime and
// that the packed manifest keeps the Cordis bundle + browser half declarations.
// This catches "works from the repo, breaks from the registry" mistakes such as
// forgetting `lib/client.js` or dropping `dsh.bundle` from the published entry.
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

const raw = execSync('npm pack --dry-run --json', {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})
const packed = JSON.parse(raw)
// npm returns an object keyed by package name; older versions return an array.
const report = Array.isArray(packed) ? packed[0] : Object.values(packed)[0]
assert.ok(report, 'npm pack must report one tarball')
assert.equal(report.name, manifest.name)
assert.equal(report.version, manifest.version, 'packed version must match package.json')

const files = report.files.map((entry) => entry.path)
for (const required of [
  'package.json',
  'lib/index.js',
  'lib/core.js',
  'lib/client.js',
  'cordis.patch.yml',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
]) {
  assert.ok(files.includes(required), `tarball must contain ${required}`)
}

assert.ok(!files.some((file) => file.startsWith('test/')), 'tests must stay out of the tarball')
assert.ok(!files.some((file) => file.startsWith('_dsh_inspect/')), 'local scratch files must stay out of the tarball')

assert.ok(report.unpackedSize > 0, 'packed size must be non-zero')

// The published manifest keeps the two extension points that make the plugin
// installable (Cordis bundle patch) and configurable in the browser (client half).
assert.ok(manifest.dsh?.bundle?.patch, 'dsh.bundle.patch must be declared')
assert.equal(manifest.dsh?.client?.platform, 'web')
assert.ok(Array.isArray(manifest.dsh.client.inject), 'dsh.client.inject must be a list')
assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-commands'), 'client half must declare the command service')
assert.ok(manifest.exports?.['./client'], 'exports["./client"] must be published')
assert.ok(manifest.engines?.node, 'engines.node must be published')

console.log(`pack smoke: ${files.length} files, ${report.unpackedSize} unpacked bytes, manifest ok`)
