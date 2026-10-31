/**
 * Run one platform instance without the console's pages: the API, file downloads and apps' web
 * applications, plus background jobs. In cluster mode, start as many as needed (on one machine
 * or several, each with its own home as a cache) behind a load balancer; the console pages
 * (`npm run start`) forward to the same API.
 *
 *   node console/bin/serve.ts [--port 8780] [--host 127.0.0.1]
 *
 * `RSI_HOME` picks the home (cache) directory; `RSI_WORKERS=0` makes an instance serve only.
 */

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { startPlatform } from '../core/http.ts'

const platformDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const port = Number(arg('port', process.env.PORT ?? '8780'))
const host = arg('host', '127.0.0.1')

const { platform, handler } = await startPlatform(platformDir)

async function forward(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue
    for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one)
  }
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : (Readable.toWeb(req) as ReadableStream<Uint8Array>)
  const request = new Request(`http://${req.headers.host ?? `${host}:${port}`}${req.url ?? '/'}`, { method: req.method, headers, body, duplex: 'half' } as RequestInit)
  const response = await handler(request)
  const out: Record<string, string | string[]> = {}
  response.headers.forEach((value, key) => {
    if (key === 'set-cookie') return
    out[key] = value
  })
  const cookies = response.headers.getSetCookie()
  if (cookies.length) out['set-cookie'] = cookies
  res.writeHead(response.status, out)
  if (!response.body || req.method === 'HEAD') return void res.end()
  Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>).pipe(res)
}

const server = createServer((req, res) => {
  forward(req, res).catch((error) => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: (error as Error).message }))
  })
})
server.listen(port, host, () => process.stderr.write(`[rsi] 实例 ${platform.deployment.instance} 在 http://${host}:${port}\n`))

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    process.stderr.write(`[rsi] 停止实例 ${platform.deployment.instance}…\n`)
    server.close()
    void platform.close().finally(() => process.exit(0))
  })
}
