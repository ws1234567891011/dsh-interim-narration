// End-to-end test for the subagent narration switch: boots a temporary
// headless DSH profile against an in-process mock LLM, has the parent agent
// call the `subagent` tool, and asserts that the child request carries no
// narration section while the parent request still does. Skips cleanly when
// no DSH launcher is available (for example on GitHub-hosted CI).
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const PROFILE_PREFIX = 'e2e-subagent'

function findCli() {
  if (process.env.DSH_CLI) return process.env.DSH_CLI
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
    const candidates = [
      path.join(base, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
      path.join(base, 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
    ]
    for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate
  }
  const command = process.platform === 'win32' ? 'cmd.exe' : 'dsh'
  const args = process.platform === 'win32' ? ['/c', 'dsh', '--version'] : ['--version']
  const probe = spawnSync(command, args, { encoding: 'utf8', timeout: 30000 })
  if (probe.status === 0 && /^\d+\.\d+/.test(String(probe.stdout ?? '').trim())) return 'dsh'
  return null
}

function runCli(cli, args, options = {}) {
  const quote = (value) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value)
  const base = {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
  }
  const command = process.platform === 'win32' ? `${quote(cli)} ${args.map(quote).join(' ')}` : cli
  const launch = process.platform === 'win32' ? { ...base, shell: true } : base
  const timeout = options.timeout ?? 240000
  return new Promise((resolve) => {
    const child = spawn(command, process.platform === 'win32' ? [] : args, launch)
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk.toString()))
    child.stderr.on('data', (chunk) => stderr.push(chunk.toString()))
    const timer = setTimeout(() => child.kill(), timeout)
    child.on('close', (status) => {
      clearTimeout(timer)
      resolve({ status, stdout: stdout.join(''), stderr: stderr.join('') })
    })
  })
}

function sseChunk(object) {
  return `data: ${JSON.stringify(object)}\n\n`
}

function systemTextOf(body) {
  const messages = body?.messages
  if (!Array.isArray(messages)) return ''
  const system = messages.find((message) => message?.role === 'system')
  return String(system?.content ?? '')
}

/** Start an OpenAI-compatible mock that lets the parent call the subagent tool. */
async function startMock() {
  const requests = []
  let parentRequests = 0
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model', owned_by: 'mock' }] }))
      return
    }
    if (req.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `no route ${req.method} ${url.pathname}` } }))
      return
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    let body = null
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      body = null
    }
    requests.push({ path: url.pathname, body })
    const created = Math.floor(Date.now() / 1000)
    const base = { id: `chatcmpl-mock-${requests.length}`, object: 'chat.completion.chunk', created, model: body?.model ?? 'mock-model' }
    const hasNarration = systemTextOf(body).includes('## 过程叙述')
    if (hasNarration) parentRequests += 1
    const wantsToolCall = hasNarration && parentRequests === 1
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    if (wantsToolCall) {
      res.write(
        sseChunk({
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_probe_1',
                    type: 'function',
                    function: {
                      name: 'subagent',
                      arguments: JSON.stringify({ description: 'probe child', prompt: 'Reply with exactly: CHILD-OK' }),
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
      )
      res.write(sseChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }))
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    const content = hasNarration ? 'PARENT-OK' : 'CHILD-OK'
    res.write(sseChunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] }))
    res.write(sseChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }))
    res.write('data: [DONE]\n\n')
    res.end()
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    port: server.address().port,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const cli = findCli()
if (!cli) {
  console.log('e2e-subagent: SKIPPED - no DSH launcher found (set DSH_CLI to a dsh launcher to run this test)')
  process.exit(0)
}

const started = Date.now()
const profile = `${PROFILE_PREFIX}-${Date.now().toString(36)}`
const dshHome = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const profileDir = path.join(dshHome, 'profiles', profile)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-narration-subagent-'))
const logFile = path.join(tmp, 'narration.log')
const overlay = path.join(tmp, 'overlay.yml')
const mock = await startMock()

try {
  console.log(`e2e-subagent: profile=${profile} mock=http://127.0.0.1:${mock.port}`)

  const created = await runCli(cli, ['--profile', profile, '--from-default-profile', 'headless', '--dump-config'], {
    cwd: tmp,
    timeout: 120000,
  })
  assert(created.status === 0, `profile creation failed: ${created.stderr || created.stdout}`)
  assert(fs.existsSync(path.join(profileDir, 'package.json')), 'profile package.json missing')

  const pluginDest = path.join(profileDir, 'node_modules', 'dsh-interim-narration')
  fs.cpSync(path.join(ROOT, 'lib'), path.join(pluginDest, 'lib'), { recursive: true })
  for (const file of ['package.json', 'cordis.patch.yml']) fs.copyFileSync(path.join(ROOT, file), path.join(pluginDest, file))

  const yaml = [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      mock:',
    '        api: openai-completions',
    '        apiKeyEnv: MOCK_API_KEY',
    `        baseURL: http://127.0.0.1:${mock.port}/v1`,
    '        models:',
    '          - id: mock-model',
    '- id: agent-default-model',
    '  config:',
    '    provider: mock',
    '    model: mock-model',
    '- insert:',
    '    - id: dsh-interim-narration',
    '      name: dsh-interim-narration',
    '      config:',
    '        enabled: true',
    '        language: zh',
    '        subagents: skip',
    '        debug: true',
    `        logFile: ${logFile.replace(/\\/g, '/')}`,
  ].join('\n')
  fs.writeFileSync(overlay, `${yaml}\n`)

  const task = await runCli(cli, ['--profile', profile, '--patch', overlay, 'Call the subagent tool once, then reply with exactly: DONE'], {
    cwd: tmp,
    env: { MOCK_API_KEY: 'mock-key', DSH_PERMISSION_MODE: 'danger-full-access' },
  })
  assert(task.status === 0, `headless task failed (exit ${task.status}): ${(task.stderr || task.stdout || '').slice(-800)}`)
  assert(String(task.stdout ?? '').includes('PARENT-OK'), `task output did not contain PARENT-OK: ${String(task.stdout ?? '').slice(-400)}`)

  const childRequests = mock.requests.filter((entry) => !systemTextOf(entry.body).includes('## 过程叙述'))
  const parentRequests = mock.requests.filter((entry) => systemTextOf(entry.body).includes('## 过程叙述'))
  assert(childRequests.length >= 1, 'the mock never received a child (subagent) chat request')
  assert(parentRequests.length >= 2, 'the parent request never continued after the tool call')
  for (const entry of childRequests) {
    const text = systemTextOf(entry.body)
    assert(!text.includes('## 过程叙述'), 'subagent request still carries the narration contract')
    assert(!text.includes('## 过程叙述提醒'), 'subagent request still carries the reminder section')
  }
  assert(
    parentRequests.every((entry) => systemTextOf(entry.body).includes('## 过程叙述提醒')),
    'parent requests must keep both narration sections',
  )

  assert(fs.existsSync(logFile), 'debug log was not written')
  const logText = fs.readFileSync(logFile, 'utf8')
  assert(/mounted order=\d+.*subagents=skip/.test(logText), 'debug log does not show subagents=skip')

  console.log(
    `e2e-subagent: PASS (${((Date.now() - started) / 1000).toFixed(1)}s) ` +
      `parentRequests=${parentRequests.length} childRequests=${childRequests.length} requests=${mock.requests.length}`,
  )
  process.exitCode = 0
} catch (error) {
  console.error(`e2e-subagent: FAIL - ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await mock.close()
  removeDir(profileDir)
  removeDir(tmp)
}

/** Remove a temporary directory without ever failing the test run. */
function removeDir(target) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 })
      return
    } catch (error) {
      if (attempt === 7) {
        console.warn(`e2e-subagent: cleanup skipped for ${target} (${error instanceof Error ? error.message : String(error)})`)
        return
      }
      spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'sleep', process.platform === 'win32' ? ['/c', 'timeout', '/t', '1', '/nobreak'] : ['1'])
    }
  }
}
