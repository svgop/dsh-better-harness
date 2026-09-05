import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeKnownEventTypes, probeRuntimeRegistry, forkCompatibility } from './host.js'

test('probeKnownEventTypes passes when the fork vocabulary is present', () => {
  const result = probeKnownEventTypes({
    KNOWN_SESSION_EVENT_TYPES: new Set(['turn/start', 'subagent/model-selection-default', 'subagent/runtime-provider-selection']),
  })
  assert.equal(result.present, true)
  assert.deepEqual(result.missing, [])
})

test('probeKnownEventTypes names the missing fork types', () => {
  const result = probeKnownEventTypes({ KNOWN_SESSION_EVENT_TYPES: new Set(['turn/start']) })
  assert.equal(result.present, false)
  assert.deepEqual(result.missing, ['subagent/model-selection-default', 'subagent/runtime-provider-selection'])
})

test('probeKnownEventTypes reports unresolvable harness as not present', () => {
  const result = probeKnownEventTypes(undefined)
  // Outside a harness tree the require fails; inside one it must succeed.
  if (result.cause !== undefined) {
    assert.equal(result.present, false)
    assert.ok(result.cause.length > 0)
  } else {
    assert.equal(typeof result.present, 'boolean')
  }
})

test('probeRuntimeRegistry verifies registration and enumeration', () => {
  class Registry {
    #entries = new Map()
    register(typeOrTypes, owner) {
      const types = Array.isArray(typeOrTypes) ? typeOrTypes : [typeOrTypes]
      for (const type of types) this.#entries.set(type, { owner })
      return () => { for (const type of types) this.#entries.delete(type) }
    }
    registeredEventTypes() { return [...this.#entries.keys()] }
  }
  const result = probeRuntimeRegistry({ SessionEventTypeRegistry: Registry })
  assert.equal(result.present, true)
})

test('forkCompatibility composes a stock-harness verdict', () => {
  const result = forkCompatibility({ present: false, missing: ['subagent/runtime-provider-selection'] }, { present: true })
  assert.equal(result.ok, false)
  assert.match(result.verdict, /STOCK-UPSTREAM-HARNESS/)
})

test('forkCompatibility passes on a fork build', () => {
  const result = forkCompatibility({ present: true, missing: [] }, { present: true })
  assert.equal(result.ok, true)
  assert.equal(result.verdict, 'fork-compatible')
})
