import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { mountSessionsStore, sessionsStorePath, API_PREFIX } from './sessions-store.js'

function fakeCtx() {
  const injections = []
  return {
    injections,
    inject: (names, body) => { injections.push({ names, body }); return () => {} },
    effect: () => () => {},
  }
}

function flush(ctx, services) {
  for (const { names, body } of ctx.injections) body(services)
}

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'bh-store-'))
  const path = join(dir, 'sessions.json')
  const ctx = fakeCtx()
  const store = mountSessionsStore(ctx, { path })
  const routes = []
  flush(ctx, {
    sessionPersistence: { list: async () => [{ header: { id: 'session-3', createdAt: 5 }, eventCount: 2 }] },
    webServer: { register: (route) => routes.push(route) },
  })
  try {
    await fn({ store, routes, path })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('reads the base document from an absent file and persists actions atomically', async () => {
  await withStore(async ({ store, path }) => {
    assert.deepEqual(await store.read(), { favorites: [], pinned: [], groups: {} })
    const next = await store.act({ type: 'toggle-favorite', sessionId: 'session-1' })
    assert.deepEqual(next.favorites, ['session-1'])
    const onDisk = JSON.parse(await readFile(path, 'utf8'))
    assert.deepEqual(onDisk.favorites, ['session-1'])
    assert.deepEqual((await store.read()).favorites, ['session-1'])
  })
})

test('acts are validated by the domain model and refuse loudly', async () => {
  await withStore(async ({ store }) => {
    await assert.rejects(() => store.act({ type: 'toggle-pin', sessionId: 'never-favorited' }), /requires a favorite/)
    await assert.rejects(() => store.act({ type: 'create-group', group: ' ' }), /non-empty/)
  })
})

test('a malformed stored document normalizes to the empty base instead of failing reads', async () => {
  await withStore(async ({ store, path }) => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path, '{"favorites": "not-a-list", "groups": {"g": [1, 2]}}', 'utf8')
    // cache was empty-file based; new store instance re-reads from disk
    const ctx2 = fakeCtx()
    const store2 = mountSessionsStore(ctx2, { path })
    flush(ctx2, { webServer: { register: () => {} }, sessionPersistence: { list: async () => [] } })
    assert.deepEqual(await store2.read(), { favorites: [], pinned: [], groups: { g: [] } })
  })
})

test('routes: GET returns state, POST applies an action, non-loopback is fenced', async () => {
  await withStore(async ({ routes }) => {
    assert.equal(routes.length, 2)
    assert.deepEqual(routes.map((route) => route.path).sort(), [API_PREFIX, `${API_PREFIX}/list`])

    const actionRoute = routes.find((route) => route.path === API_PREFIX)
    const okRes = { writeHead(status) { this.status = status }, end(b) { this.body = JSON.parse(b) } }
    await new Promise((resolve) => {
      okRes.end = (b) => { okRes.body = JSON.parse(b); resolve() }
      actionRoute.handler({ method: 'GET', socket: { remoteAddress: '127.0.0.1' } }, okRes)
    })
    assert.equal(okRes.status, 200)
    assert.equal(okRes.body.ok, true)

    const fencedRes = { writeHead(status) { this.status = status }, end(b) { this.body = JSON.parse(b) } }
    actionRoute.handler({ method: 'GET', socket: { remoteAddress: '192.168.1.5' } }, fencedRes)
    assert.equal(fencedRes.status, 403)

    const postRes = { writeHead(status) { this.status = status }, end(b) { this.body = JSON.parse(b) } }
    const payload = JSON.stringify({ action: { type: 'toggle-favorite', sessionId: 'session-2' } })
    const req = Readable.from([payload])
    req.method = 'POST'
    req.socket = { remoteAddress: '127.0.0.1' }
    req.headers = { 'content-type': 'application/json' }
    await actionRoute.handler(req, postRes)
    assert.equal(postRes.status, 200)
    assert.deepEqual(postRes.body.state.favorites, ['session-2'])
  })
})

test('list route joins persistence headers with the stored state', async () => {
  await withStore(async ({ routes }) => {
    const listRes = { writeHead(status) { this.status = status }, end(b) { this.body = JSON.parse(b) } }
    await new Promise((resolve) => {
      listRes.end = (b) => { listRes.body = JSON.parse(b); resolve() }
      routes.find((route) => route.path.endsWith('/list')).handler(
        { method: 'GET', socket: { remoteAddress: '127.0.0.1' } }, listRes)
    })
    assert.equal(listRes.status, 200)
    // JSON.stringify drops undefined members; the wire shape omits absent header fields.
    assert.deepEqual(listRes.body.sessions, [{ id: 'session-3', createdAt: 5, eventCount: 2 }])
    assert.deepEqual(listRes.body.state, { favorites: [], pinned: [], groups: {} })
  })
})

test('store path honors DSH_HOME and defaults under the user home', () => {
  const previous = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = join(tmpdir(), 'dsh-home-x')
    assert.equal(sessionsStorePath(), join(process.env.DSH_HOME, 'better-harness', 'sessions.json'))
    delete process.env.DSH_HOME
    assert.ok(sessionsStorePath().endsWith(join('.dsh', 'better-harness', 'sessions.json')))
  } finally {
    if (previous !== undefined) process.env.DSH_HOME = previous
  }
})
