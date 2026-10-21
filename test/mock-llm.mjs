// Minimal OpenAI-compatible mock LLM. Records every request body to disk and
// answers with a scripted assistant message. Used to prove that a DSH plugin's
// system-prompt section actually reaches the model request, without credentials.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.MOCK_PORT ?? 18080)
const OUT = path.join(import.meta.dirname, 'mock-llm-requests')
fs.mkdirSync(OUT, { recursive: true })

let seq = 0

function replyText(body) {
  // Echo a marker so the caller can assert on the final answer too.
  return 'MOCK-OK'
}

function sseChunk(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  if (req.method === 'GET' && url.pathname.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        object: 'list',
        data: [
          {
            id: 'mock-model',
            object: 'model',
            owned_by: 'mock',
            context_window: 131072,
            max_tokens: 8192,
          },
        ],
      }),
    )
    return
  }
  if (req.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: `no route ${req.method} ${url.pathname}` } }))
    return
  }

  const name = `req-${String(++seq).padStart(2, '0')}.json`
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  let body = null
  try {
    body = JSON.parse(raw)
  } catch {
    body = null
  }
  fs.writeFileSync(path.join(OUT, name), JSON.stringify({ path: url.pathname, body, raw }, null, 2))

  const model = body?.model ?? 'mock-model'
  const text = replyText(body)
  const created = Math.floor(Date.now() / 1000)

  if (body?.stream === false) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        id: `chatcmpl-mock-${seq}`,
        object: 'chat.completion',
        created,
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    )
    return
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  const base = { id: `chatcmpl-mock-${seq}`, object: 'chat.completion.chunk', created, model }
  res.write(sseChunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] }))
  res.write(
    sseChunk({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
  )
  res.write('data: [DONE]\n\n')
  res.end()
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock llm listening on http://127.0.0.1:${PORT}`)
  console.log(`requests -> ${OUT}`)
})
