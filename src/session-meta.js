/**
 * Pure domain model for user-authored session metadata: favorites, pins,
 * and groups. The persistence lane (host settings namespace
 * `better-harness.sessions`) stores one JSON document; every mutation here
 * is a pure (state, action) -> state transition, and every read is a pure
 * query. UI phases consume this module; nothing here touches cordis or the
 * DOM, so the whole model is unit-testable in isolation.
 */

/** Maximum groups and name length — bounded by validation, mirroring harness settings schemas. */
export const LIMITS = Object.freeze({
  maxGroups: 50,
  maxNameLength: 60,
  maxSessionsPerGroup: 500,
})

/** Empty document — the stored shape when the namespace has no value yet. */
export function emptySessionMeta() {
  return { favorites: [], pinned: [], groups: {} }
}

function sessionIds(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id) => typeof id === 'string' && id.length > 0))]
}

/**
 * Validate and normalize one stored document.
 * @param {unknown} value - raw stored value (may be absent or malformed).
 * @returns {{ favorites: string[], pinned: string[], groups: Record<string, string[]> }}
 */
export function normalizeSessionMeta(value) {
  if (typeof value !== 'object' || value === null) return emptySessionMeta()
  const raw = value
  const favorites = sessionIds(raw.favorites)
  // A pinned session is implicitly favorite-worthy but the two lists stay
  // independent — pinning is ordering, favoriting is membership.
  const pinned = sessionIds(raw.pinned).filter((id) => favorites.includes(id))
  const groups = {}
  if (typeof raw.groups === 'object' && raw.groups !== null) {
    const entries = Object.entries(raw.groups)
      .filter(([name]) => typeof name === 'string' && name.trim().length > 0)
      .slice(0, LIMITS.maxGroups)
    for (const [name, members] of entries) {
      groups[name.trim().slice(0, LIMITS.maxNameLength)] = sessionIds(members).slice(0, LIMITS.maxSessionsPerGroup)
    }
  }
  return { favorites, pinned, groups }
}

/**
 * Apply one mutation to a stored document.
 * @param {unknown} state - current stored value.
 * @param {{ type: string, sessionId?: string, group?: string, from?: string, to?: string }} action
 *   - toggle-favorite / toggle-pin (sessionId)
 *   - create-group / delete-group (group)
 *   - rename-group (from, to)
 *   - toggle-group-member (sessionId, group)
 * @returns {{ favorites: string[], pinned: string[], groups: Record<string, string[]> }}
 *   the next document; throws on invalid action shapes.
 */
export function applySessionMetaAction(state, action) {
  const next = normalizeSessionMeta(state)
  const fail = (why) => { throw new Error(`session-meta: ${why}`) }
  switch (action?.type) {
    case 'toggle-favorite': {
      const id = action.sessionId
      if (typeof id !== 'string' || id.length === 0) fail('toggle-favorite requires a sessionId')
      if (next.favorites.includes(id)) {
        next.favorites = next.favorites.filter((x) => x !== id)
        next.pinned = next.pinned.filter((x) => x !== id)
      } else next.favorites = [...next.favorites, id]
      return next
    }
    case 'toggle-pin': {
      const id = action.sessionId
      if (typeof id !== 'string' || id.length === 0) fail('toggle-pin requires a sessionId')
      if (!next.favorites.includes(id)) fail('toggle-pin requires a favorite session (pin implies favorite)')
      next.pinned = next.pinned.includes(id)
        ? next.pinned.filter((x) => x !== id)
        : [...next.pinned, id]
      return next
    }
    case 'create-group': {
      const name = typeof action.group === 'string' ? action.group.trim() : ''
      if (name.length === 0) fail('create-group requires a non-empty group name')
      if (name.length > LIMITS.maxNameLength) fail(`create-group name exceeds ${LIMITS.maxNameLength} characters`)
      if (Object.keys(next.groups).length >= LIMITS.maxGroups) fail(`create-group exceeds ${LIMITS.maxGroups} groups`)
      if (next.groups[name] !== undefined) fail(`create-group: "${name}" already exists`)
      next.groups = { ...next.groups, [name]: [] }
      return next
    }
    case 'delete-group': {
      const name = action.group
      if (typeof name !== 'string' || next.groups[name] === undefined) fail(`delete-group: "${String(name)}" does not exist`)
      const groups = { ...next.groups }
      delete groups[name]
      next.groups = groups
      return next
    }
    case 'rename-group': {
      const from = action.from
      const to = typeof action.to === 'string' ? action.to.trim() : ''
      if (typeof from !== 'string' || next.groups[from] === undefined) fail(`rename-group: "${String(from)}" does not exist`)
      if (to.length === 0) fail('rename-group requires a non-empty new name')
      if (next.groups[to] !== undefined) fail(`rename-group: "${to}" already exists`)
      const groups = { ...next.groups }
      groups[to] = groups[from]
      delete groups[from]
      next.groups = groups
      return next
    }
    case 'toggle-group-member': {
      const id = action.sessionId
      const name = action.group
      if (typeof id !== 'string' || id.length === 0) fail('toggle-group-member requires a sessionId')
      if (typeof name !== 'string' || next.groups[name] === undefined) fail(`toggle-group-member: unknown group "${String(name)}"`)
      const members = next.groups[name]
      next.groups = {
        ...next.groups,
        [name]: members.includes(id)
          ? members.filter((x) => x !== id)
          : [...members, id].slice(0, LIMITS.maxSessionsPerGroup),
      }
      return next
    }
    default:
      fail(`unknown action type ${JSON.stringify(action?.type)}`)
  }
}

/**
 * Compute the effective grouping for one session, used by the sidebar's
 * group view: pinned first, then groups in membership order, then ungrouped.
 * @param {unknown} state - stored document.
 * @param {string} sessionId - session to classify.
 * @returns {{ pinned: boolean, groups: string[] }} membership facts.
 */
export function sessionMembership(state, sessionId) {
  const meta = normalizeSessionMeta(state)
  return {
    pinned: meta.pinned.includes(sessionId),
    groups: Object.keys(meta.groups).filter((name) => meta.groups[name].includes(sessionId)),
  }
}

/**
 * Filter and sort a session list by the stored metadata.
 * @param {unknown} state - stored document.
 * @param {Array<{ id: string, title?: string, updatedAt?: number }>} sessions - input rows.
 * @param {{ group?: string, favoritesOnly?: boolean, orderBy?: 'recency'|'title' }} [options]
 *   `group` filters to one group's members; favoritesOnly narrows further;
 *   orderBy sorts (default recency via updatedAt desc, stable by id).
 * @returns {Array<{ id: string, title?: string, updatedAt?: number, pinned: boolean, groups: string[] }>}
 */
export function querySessions(state, sessions, options = {}) {
  const meta = normalizeSessionMeta(state)
  const input = Array.isArray(sessions) ? sessions.filter((s) => s && typeof s.id === 'string') : []
  const order = options.orderBy === 'title' ? 'title' : 'recency'
  let rows = input.map((s) => ({
    ...s,
    pinned: meta.pinned.includes(s.id),
    groups: Object.keys(meta.groups).filter((name) => meta.groups[name].includes(s.id)),
  }))
  if (options.group !== undefined) {
    const members = new Set(meta.groups[options.group] ?? [])
    rows = rows.filter((r) => members.has(r.id))
  }
  if (options.favoritesOnly === true) rows = rows.filter((r) => meta.favorites.includes(r.id))
  rows.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (order === 'title') {
      const at = typeof a.title === 'string' ? a.title : ''
      const bt = typeof b.title === 'string' ? b.title : ''
      if (at !== bt) return at < bt ? -1 : 1
    }
    const au = typeof a.updatedAt === 'number' ? a.updatedAt : -Infinity
    const bu = typeof b.updatedAt === 'number' ? b.updatedAt : -Infinity
    if (au !== bu) return bu - au
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return rows
}
