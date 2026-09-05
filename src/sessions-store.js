/**
 * Host sessions store: the persistence lane for user-authored session
 * metadata. One settings namespace (`better-harness.sessions`) holds the
 * document; every mutation routes through the pure domain model
 * (session-meta.js) so host-side validation and client-side UI share one
 * rulebook. Routes expose read + act to the browser half.
 */

import { createRequire } from 'node:module'
import { emptySessionMeta, normalizeSessionMeta, applySessionMetaAction, LIMITS } from './session-meta.js'

const require = createRequire(import.meta.url)

export const SESSIONS_NS = 'better-harness.sessions'
export const API_PREFIX = '/api/better-harness/sessions'

/**
 * Build the namespace schema from the resolved schemastery.
 * @param {object} [z] - schemastery module; resolved from the installed tree when omitted.
 */
function sessionsSchema(z) {
  const schemaLib = z ?? require('@deepseek-ai/schemastery')
  return schemaLib.object({
    favorites: z.array(z.string()).default([]),
    pinned: z.array(z.string()).default([]),
    groups: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(LIMITS.maxNameLength),
      order: z.number().default(0),
    })).default([]),
    assignments: z.object({}).default({}),
  })
}

/**
 * Mount the namespace and routes on a host context.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @returns {{ read: () => object, act: (action: object) => object }} the store surface (also routed).
 */
export function mountSessionsStore(ctx, { z } = {}) {
  let scope = null
  let settingsService = null

  ctx.inject(['settings'], (settingsCtx) => {
    settingsService = settingsCtx.settings
    scope = settingsService.register(SESSIONS_NS, sessionsSchema(z), {
      base: emptySessionMeta(),
      validate: (value) => { normalizeSessionMeta(value) },
    })
  })

  /** Current normalized document. */
  const read = () => (scope ? normalizeSessionMeta(scope.get()) : emptySessionMeta())

  /** Apply one domain action and persist the next document whole. */
  const act = (action) => {
    if (scope === null) throw new Error('dsh-better-harness: settings service not yet mounted')
    const next = applySessionMetaAction(read(), action)
    const write = typeof settingsService.replace === 'function'
      ? settingsService.replace(SESSIONS_NS, next)
      : settingsService.update(SESSIONS_NS, next)
    return write instanceof Promise ? write.then(() => next) : next
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
          listSessions()
            .then((sessions) => json(res, 200, { ok: true, state: read(), sessions }))
            .catch((error) => json(res, 500, { ok: false, error: String(error.message ?? error) }))
        },
      })
    })
  })

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.webServer.register({
      kind: 'exact',
      path: API_PREFIX,
      // eslint-disable-next-line no-unused-vars -- route runner may await the handler
      handler: async (req, res) => {
        if (!isLoopback(req)) { json(res, 403, { ok: false, error: 'loopback-only' }); return }
        if (req.method === 'GET') { json(res, 200, { ok: true, state: read() }); return }
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
          const action = body?.action
          const state = await act(action)
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
