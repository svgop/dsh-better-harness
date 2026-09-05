import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptySessionMeta, normalizeSessionMeta, applySessionMetaAction,
  sessionMembership, querySessions,
} from './session-meta.js'

const S = (id, title, updatedAt) => ({ id, title, updatedAt })

test('normalize tolerates absent and malformed documents', () => {
  assert.deepEqual(normalizeSessionMeta(undefined), emptySessionMeta())
  assert.deepEqual(normalizeSessionMeta('junk'), emptySessionMeta())
  assert.deepEqual(normalizeSessionMeta({ favorites: 'no', groups: 7 }), emptySessionMeta())
})

test('normalize dedupes ids and drops pins without favorites', () => {
  const meta = normalizeSessionMeta({
    favorites: ['a', 'a', ''],
    pinned: ['a', 'ghost'],
    groups: { ' g ': ['a', 'a'] },
  })
  assert.deepEqual(meta.favorites, ['a'])
  assert.deepEqual(meta.pinned, ['a']) // ghost pin dropped — pin implies favorite
  assert.deepEqual(meta.groups, { g: ['a'] })
})

test('toggle-favorite adds and removes, and removal drops the pin', () => {
  let state = applySessionMetaAction(emptySessionMeta(), { type: 'toggle-favorite', sessionId: 'a' })
  assert.deepEqual(state.favorites, ['a'])
  state = applySessionMetaAction(state, { type: 'toggle-pin', sessionId: 'a' })
  assert.deepEqual(state.pinned, ['a'])
  state = applySessionMetaAction(state, { type: 'toggle-favorite', sessionId: 'a' })
  assert.deepEqual(state.favorites, [])
  assert.deepEqual(state.pinned, [])
})

test('toggle-pin refuses sessions that are not favorites', () => {
  assert.throws(
    () => applySessionMetaAction(emptySessionMeta(), { type: 'toggle-pin', sessionId: 'a' }),
    /requires a favorite/,
  )
})

test('group lifecycle: create, rename, delete', () => {
  let state = applySessionMetaAction(emptySessionMeta(), { type: 'create-group', group: 'refactor' })
  assert.throws(() => applySessionMetaAction(state, { type: 'create-group', group: 'refactor' }), /already exists/)
  state = applySessionMetaAction(state, { type: 'rename-group', from: 'refactor', to: 'epic' })
  assert.deepEqual(Object.keys(state.groups), ['epic'])
  state = applySessionMetaAction(state, { type: 'delete-group', group: 'epic' })
  assert.deepEqual(state.groups, {})
})

test('toggle-group-member adds and removes membership', () => {
  let state = applySessionMetaAction(emptySessionMeta(), { type: 'create-group', group: 'g' })
  state = applySessionMetaAction(state, { type: 'toggle-group-member', sessionId: 'a', group: 'g' })
  assert.deepEqual(state.groups.g, ['a'])
  state = applySessionMetaAction(state, { type: 'toggle-group-member', sessionId: 'a', group: 'g' })
  assert.deepEqual(state.groups.g, [])
  assert.throws(
    () => applySessionMetaAction(state, { type: 'toggle-group-member', sessionId: 'a', group: 'nope' }),
    /unknown group/,
  )
})

test('unknown actions fail loud', () => {
  assert.throws(() => applySessionMetaAction(emptySessionMeta(), { type: 'nuke' }), /unknown action type/)
})

test('sessionMembership reports pinned state and group membership', () => {
  let state = applySessionMetaAction(emptySessionMeta(), { type: 'toggle-favorite', sessionId: 'a' })
  state = applySessionMetaAction(state, { type: 'toggle-pin', sessionId: 'a' })
  state = applySessionMetaAction(state, { type: 'create-group', group: 'g' })
  state = applySessionMetaAction(state, { type: 'toggle-group-member', sessionId: 'a', group: 'g' })
  assert.deepEqual(sessionMembership(state, 'a'), { pinned: true, groups: ['g'] })
  assert.deepEqual(sessionMembership(state, 'b'), { pinned: false, groups: [] })
})

test('querySessions filters by group and favorites, sorts pinned-first then recency', () => {
  let state = applySessionMetaAction(emptySessionMeta(), { type: 'create-group', group: 'g' })
  state = applySessionMetaAction(state, { type: 'toggle-group-member', sessionId: 'old', group: 'g' })
  state = applySessionMetaAction(state, { type: 'toggle-group-member', sessionId: 'new', group: 'g' })
  state = applySessionMetaAction(state, { type: 'toggle-favorite', sessionId: 'star-old' })
  state = applySessionMetaAction(state, { type: 'toggle-pin', sessionId: 'star-old' })

  const sessions = [
    S('new', 'Newest', 30),
    S('old', 'Oldest', 10),
    S('star-old', 'Starred but older', 20),
    S('other', 'Not in group', 40),
  ]

  const grouped = querySessions(state, sessions, { group: 'g' })
  assert.deepEqual(grouped.map((r) => r.id), ['new', 'old'])

  const favs = querySessions(state, sessions, { favoritesOnly: true })
  assert.deepEqual(favs.map((r) => r.id), ['star-old'])
  assert.equal(favs[0].pinned, true)

  const all = querySessions(state, sessions)
  assert.deepEqual(all.map((r) => r.id), ['star-old', 'other', 'new', 'old'])

  const byTitle = querySessions(state, sessions, { orderBy: 'title' })
  assert.deepEqual(byTitle.map((r) => r.title), [
    'Starred but older', 'Newest', 'Not in group', 'Oldest',
  ])
})
