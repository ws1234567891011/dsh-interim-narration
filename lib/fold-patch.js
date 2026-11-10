/**
 * Local ui-chat patch: keep the turn process foldable after a mid-turn input.
 *
 * DSH 0.2.2's ui-chat marks a turn as "interleaved" as soon as the user sends a
 * message while the assistant is still working, and that flag forces the process
 * group of that turn to stay open forever. The fix is three byte-length-equal
 * replacements inside the shipped `app.asar` bundle. They cannot live in the
 * plugin bundle itself because the ui-chat client module is already compiled.
 *
 * The replacement must not change the asar header or any file offset, so every
 * original string is swapped for a padded string of exactly the same length.
 * Everything here is local to this machine; the plugin only writes when the
 * user asks for it from the settings page.
 *
 * @module dsh-interim-narration/fold-patch
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Route served by the host half, consumed by the settings page. */
export const FOLD_PATCH_ROUTE = '/dsh-interim-narration/fold-patch'

/** Name of the backup written before the first replacement. */
export const FOLD_PATCH_BACKUP_SUFFIX = '.bak-interleaved'

/** Sidecar recording when the patch was applied, for update detection. */
export const FOLD_PATCH_META_SUFFIX = '.interleaved.json'

/** The three replacements, each pair exactly the same byte length. */
export const FOLD_PATCH_REPLACEMENTS = [
  {
    id: 'always-open',
    original: 'liveProcess || interleavedInput || turnProcessAlwaysOpen(routedNode)',
    patched: 'liveProcess || false            || turnProcessAlwaysOpen(routedNode)',
  },
  {
    id: 'group-open',
    original: 'presentation?.hasInterleavedInput === true',
    patched: 'false                                     ',
  },
  {
    id: 'content',
    original: 'hasContent: !interleavedInput &&',
    patched: 'hasContent: true              &&',
  },
]

/** Path of the child-process entry that can read the archive file itself. */
const CLI_PATH = fileURLToPath(new URL('./fold-patch-cli.mjs', import.meta.url))

/**
 * Run one patch operation in a child process.
 *
 * Electron's fs treats `app.asar` as a directory; the child sets
 * `process.noAsar = true` before touching it. The host therefore never flips
 * that flag, so the rest of its file I/O is unaffected.
 *
 * @param action - `status`, `apply` or `revert`.
 * @param file - the app.asar path.
 */
export function runPatchAction(action, file) {
  const result = spawnSync(process.execPath, [CLI_PATH, action, file], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 180_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  })
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
  if (result.error) throw new FoldPatchError(`补丁子进程启动失败：${result.error.message}`)
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new FoldPatchError(
      `补丁子进程没有返回结果${stderr === '' ? '' : `：${stderr.slice(0, 400)}`}`,
    )
  }
  if (parsed && parsed.ok === false) throw new FoldPatchError(parsed.error ?? '补丁操作失败')
  if (result.status !== 0) throw new FoldPatchError(stderr === '' ? '补丁操作失败' : stderr.slice(0, 400))
  return parsed
}

/** Thrown for expected, user-facing failures (bad path, unsupported build). */
export class FoldPatchError extends Error {
  constructor(message) {
    super(message)
    this.name = 'FoldPatchError'
  }
}

/** Count non-overlapping occurrences of `needle` inside `haystack`. */
export function countOccurrences(haystack, needle) {
  let count = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return count
    count += 1
    from = at + needle.length
  }
}

/**
 * The installed `app.asar` path.
 *
 * The host runs inside Electron, so `process.resourcesPath` is authoritative.
 * A plain-node fallback keeps the module usable from scripts and tests.
 */
export function resolveAsarPath(configured) {
  const explicit = typeof configured === 'string' ? configured.trim() : ''
  if (explicit !== '') return explicit
  if (typeof process.resourcesPath === 'string' && process.resourcesPath !== '') {
    return path.join(process.resourcesPath, 'app.asar')
  }
  return path.join(path.dirname(process.execPath), 'resources', 'app.asar')
}

/** Backup path for one asar file. */
export function backupPathFor(file) {
  return `${file}${FOLD_PATCH_BACKUP_SUFFIX}`
}

/** Sidecar path for one asar file. */
export function metaPathFor(file) {
  return `${file}${FOLD_PATCH_META_SUFFIX}`
}

/** Read the patch sidecar, or null when it does not exist / is unreadable. */
export function readFoldPatchMeta(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPathFor(file), 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

/** Record the patched archive's size and mtime so an update is detectable. */
function writeFoldPatchMeta(file) {
  try {
    const stat = fs.statSync(file)
    fs.writeFileSync(
      metaPathFor(file),
      `${JSON.stringify(
        {
          patchedAt: new Date().toISOString(),
          bytes: stat.size,
          mtimeMs: stat.mtimeMs,
        },
        null,
        2,
      )}\n`,
    )
  } catch {
    // The patch itself succeeded; a missing sidecar only weakens the update
    // hint, so never fail the apply because of it.
  }
}

/** Remove the sidecar after a revert. */
function removeFoldPatchMeta(file) {
  try {
    fs.unlinkSync(metaPathFor(file))
  } catch {
    // Already gone.
  }
}

/**
 * Inspect the bundle without writing.
 *
 * @returns {{file: string, exists: boolean, bytes: number, state: string,
 *            backup: string, backupExists: boolean, replacements: object[]}}
 *   `state` is `missing`, `original`, `patched`, `mixed` or `unknown`.
 */
export function foldPatchStatus(file) {
  const backup = backupPathFor(file)
  const base = {
    file,
    backup,
    exists: false,
    bytes: 0,
    state: 'missing',
    backupExists: false,
    replacements: [],
  }
  let bytes
  try {
    bytes = fs.readFileSync(file)
  } catch (error) {
    base.error = error && error.code ? `${error.code}: ${error.message}` : String(error)
    base.resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : null
    return base
  }
  base.exists = true
  base.bytes = bytes.length
  try {
    base.backupExists = fs.statSync(backup).isFile()
  } catch {
    base.backupExists = false
  }
  base.meta = readFoldPatchMeta(file)

  let originals = 0
  let patched = 0
  base.replacements = FOLD_PATCH_REPLACEMENTS.map((item) => {
    const original = countOccurrences(bytes, Buffer.from(item.original))
    const done = countOccurrences(bytes, Buffer.from(item.patched))
    originals += original
    patched += done
    return { id: item.id, original, patched: done }
  })

  if (originals === 0 && patched === FOLD_PATCH_REPLACEMENTS.length) {
    base.state = 'patched'
  } else if (patched === 0 && originals === FOLD_PATCH_REPLACEMENTS.length) {
    base.state = 'original'
  } else if (originals > 0 || patched > 0) {
    base.state = 'mixed'
  } else {
    base.state = 'unknown'
  }
  // Original bytes plus a sidecar means the patch used to be applied but the
  // archive was replaced — almost always a DSH update. The page turns this
  // into "re-enable the patch" instead of "not patched yet".
  base.stale = base.state === 'original' && base.meta !== null
  return base
}

/**
 * Apply the patch. Idempotent: calling it on an already patched bundle is fine.
 *
 * The backup is taken before the first write, so `revert` never depends on
 * reconstructing the original bytes.
 */
export function applyFoldPatch(file) {
  const current = foldPatchStatus(file)
  if (!current.exists) throw new FoldPatchError(`找不到 ${file}`)
  if (current.state === 'patched') {
    if (!current.meta) writeFoldPatchMeta(file)
    return { ...foldPatchStatus(file), changed: false }
  }
  if (current.state !== 'original' && current.state !== 'mixed') {
    throw new FoldPatchError('这个 app.asar 里找不到预期的 ui-chat 代码，可能版本已变化')
  }

  if (!current.backupExists) fs.copyFileSync(file, backupPathFor(file))

  const handle = fs.openSync(file, 'r+')
  try {
    for (const item of FOLD_PATCH_REPLACEMENTS) {
      const original = Buffer.from(item.original)
      const patched = Buffer.from(item.patched)
      if (original.length !== patched.length) {
        throw new FoldPatchError(`内部错误：${item.id} 的替换长度不一致`)
      }
      let from = 0
      for (;;) {
        const chunk = Buffer.alloc(Math.min(8 * 1024 * 1024, current.bytes))
        // Reading the whole file once per replacement is wasteful; read in
        // chunks with overlap so the marker is found even across boundaries.
        const at = findInFile(handle, original, current.bytes, from, chunk)
        if (at === -1) break
        fs.writeSync(handle, patched, 0, patched.length, at)
        from = at + patched.length
      }
    }
  } finally {
    fs.closeSync(handle)
  }
  writeFoldPatchMeta(file)
  return { ...foldPatchStatus(file), changed: true }
}

/**
 * Revert to the pre-patch bytes.
 *
 * Prefers the backup. Falls back to exchanging the padded strings back, which
 * keeps the file usable even if the backup was deleted.
 */
export function revertFoldPatch(file) {
  const current = foldPatchStatus(file)
  if (!current.exists) throw new FoldPatchError(`找不到 ${file}`)
  if (current.backupExists) {
    fs.copyFileSync(backupPathFor(file), file)
    removeFoldPatchMeta(file)
    return { ...foldPatchStatus(file), changed: true, restoredFrom: 'backup' }
  }
  if (current.state !== 'patched') {
    throw new FoldPatchError('没有备份，且文件不是补丁状态，无法自动回滚')
  }
  const handle = fs.openSync(file, 'r+')
  try {
    for (const item of FOLD_PATCH_REPLACEMENTS) {
      const original = Buffer.from(item.original)
      const patched = Buffer.from(item.patched)
      let from = 0
      const chunk = Buffer.alloc(Math.min(8 * 1024 * 1024, current.bytes))
      for (;;) {
        const at = findInFile(handle, patched, current.bytes, from, chunk)
        if (at === -1) break
        fs.writeSync(handle, original, 0, original.length, at)
        from = at + original.length
      }
    }
  } finally {
    fs.closeSync(handle)
  }
  removeFoldPatchMeta(file)
  return { ...foldPatchStatus(file), changed: true, restoredFrom: 'strings' }
}

/** Find `needle` in an open file handle, reading bounded chunks. */
function findInFile(handle, needle, size, start, scratch) {
  const step = Math.max(1024, scratch.length - needle.length + 1)
  let position = start
  while (position < size) {
    const want = Math.min(step, size - position)
    const chunk = scratch.subarray(0, want)
    const read = fs.readSync(handle, chunk, 0, want, position)
    if (read <= 0) return -1
    const at = chunk.subarray(0, read).indexOf(needle)
    if (at !== -1) return position + at
    position += step
  }
  return -1
}

/** Read a JSON request body with a small size cap. */
export function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > limit) {
        reject(new FoldPatchError('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new FoldPatchError('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * The HTTP handler behind {@link FOLD_PATCH_ROUTE}.
 *
 * GET returns the current status; POST `{action: "apply" | "revert"}` changes
 * it. Nothing is written unless the settings page asks.
 */
export async function foldPatchHandler(req, res, resolveFile) {
  const send = (code, payload) => {
    const body = Buffer.from(JSON.stringify(payload))
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': body.length,
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
    send(405, { ok: false, error: 'method not allowed' })
    return
  }

  try {
    const file = resolveAsarPath(resolveFile())
    if (req.method === 'GET' || req.method === 'HEAD') {
      send(200, { ok: true, ...runPatchAction('status', file) })
      return
    }
    const body = await readJsonBody(req)
    const action = typeof body.action === 'string' ? body.action : ''
    if (action === 'apply' || action === 'revert') {
      const result = runPatchAction(action, file)
      send(200, { ok: true, action, ...result })
      return
    }
    send(400, { ok: false, error: 'action must be "apply" or "revert"' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    send(error instanceof FoldPatchError ? 400 : 500, { ok: false, error: message })
  }
}
