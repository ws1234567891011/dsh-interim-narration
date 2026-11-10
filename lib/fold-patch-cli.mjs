/**
 * Child-process entry for the local ui-chat patch.
 *
 * The host runs inside Electron, where Node's `fs` treats `app.asar` as an
 * archive and refuses to read the archive file itself (the failure looks like
 * `ENOENT ... not found in app.asar`). `process.noAsar` disables that layer,
 * but toggling it inside the host would briefly break every other read of the
 * bundle. Running the operation in a child process keeps the host untouched.
 *
 * Usage: node fold-patch-cli.mjs <status|apply|revert> <asar path>
 * The result is one JSON object on stdout; exit code 1 means it failed.
 *
 * @module dsh-interim-narration/fold-patch-cli
 */

process.noAsar = true

const [, , action, file] = process.argv

try {
  if (typeof file !== 'string' || file === '') throw new Error('asar path is required')
  const { applyFoldPatch, foldPatchStatus, revertFoldPatch } = await import('./fold-patch.js')
  let result
  if (action === 'status') result = foldPatchStatus(file)
  else if (action === 'apply') result = { ...applyFoldPatch(file), ok: true, action }
  else if (action === 'revert') result = { ...revertFoldPatch(file), ok: true, action }
  else throw new Error(`unknown action: ${action}`)
  process.stdout.write(JSON.stringify(result))
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
}
