/**
 * Host sessions store: the persistence lane for user-authored session
 * metadata. One JSON document under the DSH home
 * (`$DSH_HOME/better-harness/sessions.json`, default `~/.dsh/...`); every
 * mutation routes through the pure domain model (session-meta.js) so
 * host-side validation and client-side UI share one rulebook. Atomic
 * tmp+rename writes keep the file whole under concurrent routes. Routes
 * expose read + act + list to the browser half.
 *
 * (The settings namespace lane was tried first and is injectively invisible
 * to bundle-mounted user plugins in this cordis build — see the repo docs.)
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { emptySessionMeta, normalizeSessionMeta, applySessionMetaAction } from './session-meta.js'

export const API_PREFIX = '/api/better-harness/sessions'

/** Document path: the plugin's own lane under the DSH home. */
export function sessionsStorePath() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'better-harness', 'sessions.json')
}

/**
 * Mount the store and routes on a host context.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @param {{ path?: string }} [options] - store path override (tests).
 * @returns {{ read: () => Promise<object>, act: (action: object) => Promise<object> }}
 */
export function mountSessionsStore(ctx, options = {}) {
  const path = options.path ?? sessionsStorePath()
  let cache = null

  /** Read the document, normalizing whatever is stored. */
  const read = async () => {
    if (cache !== null) return cache
    let raw
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if ((error)?.code === 'ENOENT') raw = undefined
      else throw error
    }
    cache = raw === undefined ? emptySessionMeta() : normalizeSessionMeta(JSON.parse(raw))
    return cache
  }

  /** Apply one domain action and persist the next document atomically. */
  const act = async (action) => {
    const next = applySessionMetaAction(await read(), action)
    const tmp = `${path}.${process.pid}.tmp`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    await rename(tmp, path)
    cache = next
    return next
  }

  ctx.inject(['sessionPersistence'], (persistenceCtx) => {
    const listSessions = async () => {
      const snapshots = await persistenceCtx.sessionPersistence.list()
      return snapshots.map((snapshot) => ({
        id: String(snapshot.header.id),
        cwd: typeof snapshot.header.cwd === 'string' ? snapshot.header.cwd : undefined,
        createdAt: snapshot.header.createdAt,
        eventCount: snapshot.eventCount,
        sizeBytes: snapshot.sizeBytes,
      }))
    }
    ctx.inject(['webServer'], (webCtx) => {
      webCtx.webServer.register({
        kind: 'exact',
        path: `${API_PREFIX}/list`,
        handler: (req, res) => {
          if (!isLoopback(req)) { json(res, 403, { ok: false, error: 'loopback-only' }); return }
          if (req.method !== 'GET') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
          Promise.all([read(), listSessions()])
            .then(([state, sessions]) => json(res, 200, { ok: true, state, sessions }))
            .catch((error) => json(res, 500, { ok: false, error: String(error.message ?? error) }))
        },
      })
    })
  })

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.webServer.register({
      kind: 'exact',
      path: API_PREFIX,
      handler: async (req, res) => {
        if (!isLoopback(req)) { json(res, 403, { ok: false, error: 'loopback-only' }); return }
        if (req.method === 'GET') {
          read().then((state) => json(res, 200, { ok: true, state }))
            .catch((error) => json(res, 500, { ok: false, error: String(error.message ?? error) }))
          return
        }
        if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
        if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
          json(res, 415, { ok: false, error: 'json-required' }); return
        }
        let body
        try { body = await readJsonBody(req) } catch (error) {
          json(res, error?.message === 'body-too-large' ? 413 : 400, { ok: false, error: error?.message ?? 'bad-request' })
          return
        }
        try {
          const state = await act(body?.action)
          json(res, 200, { ok: true, state })
        } catch (error) {
          json(res, 400, { ok: false, error: String(error.message ?? error) })
        }
      },
    })
  })

  return { read, act }
}

/** Read a bounded JSON request body (rich-tracking pattern). */
async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new Error('body-too-large')
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw === '' ? undefined : JSON.parse(raw)
}

/** Shared JSON response writer. */
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Loopback fence: the web route serves this machine's browser only. */
function isLoopback(req) {
  const remote = req.socket?.remoteAddress ?? ''
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
}
