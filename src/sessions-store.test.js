import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mountSessionsStore, SESSIONS_NS } from './sessions-store.js'

/** Schemastery stand-in: every access/apply is a chainable stub, so any
 * schema expression builds; the fake settings service ignores the result. */
const chain = new Proxy(function chain() {}, {
  get: () => chain,
  apply: () => chain,
})
const stubZ = () => chain

/** Minimal cordis stand-in: records inject callbacks and effects. */
function fakeCtx() {
  const injections = []
  return {
    injections,
    inject: (names, body) => { injections.push({ names, body }); return () => {} },
    effect: () => () => {},
  }
}

function fakeSettings() {
  let stored = null
  const watchers = []
  return {
    get stored() { return stored },
    register: (ns, _schema, options) => {
      stored = structuredClone(options.base)
      return {
        get: () => stored,
        watch: (cb) => { watchers.push(cb); return () => {} },
      }
    },
    replace: (_ns, value) => { stored = structuredClone(value) },
  }
}

/** Cordis inject hands the callback a context exposing each service
 * directly (ctx.settings === the service); extra keys are harmless. */
function flush(ctx, services) {
  for (const { names, body } of ctx.injections) body(services)
}

test('mounts the namespace, reads the base, and applies actions through the lane', () => {
  const ctx = fakeCtx()
  const settings = fakeSettings()
  const store = mountSessionsStore(ctx, { z: stubZ() })
  flush(ctx, { settings, sessionPersistence: { list: async () => [] }, webServer: { register: () => {} } })

  assert.deepEqual(store.read().favorites, [])
  const next = store.act({ type: 'toggle-favorite', sessionId: 'session-1' })
  assert.deepEqual(next.favorites, ['session-1'])
  assert.deepEqual(settings.stored.favorites, ['session-1'])
  assert.deepEqual(store.read().favorites, ['session-1'])
})

test('acts are validated by the domain model and refuse loudly', () => {
  const ctx = fakeCtx()
  const settings = fakeSettings()
  const store = mountSessionsStore(ctx, { z: stubZ() })
  flush(ctx, { settings, sessionPersistence: { list: async () => [] }, webServer: { register: () => {} } })
  assert.throws(() => store.act({ type: 'toggle-pin', sessionId: 'never-favorited' }), /requires a favorite/)
})

test('act before the settings service mounts fails loud, not silent', () => {
  const store = mountSessionsStore(fakeCtx(), { z: stubZ() })
  assert.throws(() => store.act({ type: 'toggle-favorite', sessionId: 'x' }), /not yet mounted/)
})

test('routes: GET returns state, POST applies an action, non-loopback is fenced', async () => {
  const ctx = fakeCtx()
  const settings = fakeSettings()
  const store = mountSessionsStore(ctx, { z: stubZ() })
  const routes = []
  flush(ctx, {
    settings,
    sessionPersistence: { list: async () => [{ header: { id: 'session-3', createdAt: 5 }, eventCount: 2 }] },
    webServer: { register: (route) => routes.push(route) },
  })
  assert.equal(routes.length, 2)
  assert.deepEqual(routes.map((route) => route.path).sort(), ['/api/better-harness/sessions', '/api/better-harness/sessions/list'])

  const okRes = { headers: {}, body: null, writeHead(status, headers) { this.status = status; this.headers = headers }, end(b) { this.body = JSON.parse(b) } }
  routes[0].handler({ method: 'GET', socket: { remoteAddress: '127.0.0.1' } }, okRes)
  assert.equal(okRes.status, 200)
  assert.equal(okRes.body.ok, true)

  const listRes = { headers: {}, writeHead(status) { this.status = status }, end(b) { this.body = JSON.parse(b) } }
  await new Promise((resolve) => {
    listRes.end = (b) => { listRes.body = JSON.parse(b); resolve() }
    routes.find((route) => route.path.endsWith('/list')).handler(
      { method: 'GET', socket: { remoteAddress: '127.0.0.1' } }, listRes)
  })
  assert.equal(listRes.status, 200)
  // JSON.stringify drops undefined members; the wire shape omits absent header fields.
  assert.deepEqual(listRes.body.sessions, [{ id: 'session-3', createdAt: 5, eventCount: 2 }])

  const fencedRes = { writeHead(status) { this.status = status }, end(b) { this.body = JSON.parse(b) } }
  routes[0].handler({ method: 'GET', socket: { remoteAddress: '192.168.1.5' } }, fencedRes)
  assert.equal(fencedRes.status, 403)

  const postRes = { writeHead(status) { this.status = status }, end(b) { this.body = JSON.parse(b) } }
  const req = {
    method: 'POST',
    socket: { remoteAddress: '127.0.0.1' },
    on(event, cb) { if (event === 'data') cb(JSON.stringify({ action: { type: 'toggle-favorite', sessionId: 'session-2' } })) ; if (event === 'end') setImmediate(cb) },
  }
  await new Promise((resolve) => { postRes.end = (b) => { postRes.body = JSON.parse(b); resolve() }; routes[0].handler(req, postRes) })
  assert.equal(postRes.status, 200)
  assert.deepEqual(postRes.body.state.favorites, ['session-2'])
  assert.deepEqual(settings.stored.favorites, ['session-2'])
})

test('namespace name is stable (the settings document key)', () => {
  assert.equal(SESSIONS_NS, 'better-harness.sessions')
})
