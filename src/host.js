/**
 * dsh-better-harness — fork-local capabilities for the savageops harness fork.
 *
 * v0.1.0 ships the boot-time fork compatibility guard: the fork's harness
 * patches admit fork-written session history (plugin event types, plugin
 * payload forms) through four read-path layers. A stock upstream harness
 * silently refuses those sessions. This plugin probes the mounted harness at
 * boot and reports exactly which admissions are present, so a wrong-harness
 * deployment says so loudly at startup instead of failing per session later.
 *
 * The plugin is also the designated home for future fork features that
 * compose through public seams (slots, tools, session-event registration).
 * In-tree patches remain only where no public seam exists.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const FORK_EVENT_TYPES = [
  // Written by the fork's subagent model/runtime selection; admitted by the
  // static KNOWN_SESSION_EVENT_TYPES set generated inside the fork.
  'subagent/model-selection-default',
  'subagent/runtime-provider-selection',
]

/**
 * Probe the static vocabulary the persistence layer validates against.
 * @param {{ KNOWN_SESSION_EVENT_TYPES?: Set<string> }} [sessionModule] - injected for tests.
 * @returns {{ present: boolean, missing: string[], cause?: string }}
 */
export function probeKnownEventTypes(sessionModule) {
  try {
    const mod = sessionModule ?? require('@deepseek-ai/dsh-session')
    const known = mod.KNOWN_SESSION_EVENT_TYPES
    if (!(known instanceof Set)) throw new Error('KNOWN_SESSION_EVENT_TYPES is not a Set')
    const missing = FORK_EVENT_TYPES.filter((type) => !known.has(type))
    return { present: missing.length === 0, missing }
  } catch (error) {
    return { present: false, missing: [], cause: String(error) }
  }
}

/**
 * Probe the session-event registration surface the fork's read path threads.
 * @param {{ SessionEventTypeRegistry?: new () => any }} [sessionModule] - injected for tests.
 * @returns {{ present: boolean, cause?: string }}
 */
export function probeRuntimeRegistry(sessionModule) {
  try {
    const mod = sessionModule ?? require('@deepseek-ai/dsh-session')
    const registry = new mod.SessionEventTypeRegistry()
    const dispose = registry.register('fork/guard-probe', 'dsh-better-harness')
    const enumerated = registry.registeredEventTypes().includes('fork/guard-probe')
    dispose()
    return { present: enumerated }
  } catch (error) {
    return { present: false, cause: String(error) }
  }
}

/**
 * Compose the boot verdict from both probes.
 * @param {ReturnType<typeof probeKnownEventTypes>} known - static vocabulary probe.
 * @param {ReturnType<typeof probeRuntimeRegistry>} registry - registry probe.
 * @returns {{ ok: boolean, verdict: string, detail: string }}
 */
export function forkCompatibility(known, registry) {
  const ok = known.present && registry.present
  const verdict = ok
    ? 'fork-compatible'
    : 'STOCK-UPSTREAM-HARNESS — fork-written sessions (subagent selection events, tracking/* plugin events) will refuse to open'
  const detail = `(static vocabulary: ${known.present ? 'ok' : `missing ${JSON.stringify(known.missing)}${known.cause ? ` — ${known.cause}` : ''}`}; `
    + `runtime registry enumeration: ${registry.present ? 'ok' : `absent${registry.cause ? ` — ${registry.cause}` : ''}`})`
  return { ok, verdict, detail }
}

export const inject = []

/**
 * Mount the fork compatibility guard: report read-path admission state once at boot.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @returns {void}
 */
export function apply(ctx) {
  const result = forkCompatibility(probeKnownEventTypes(), probeRuntimeRegistry())
  ctx('info', `[dsh-better-harness] ${result.verdict} ${result.detail}`)
  if (!result.ok) {
    ctx('warn', '[dsh-better-harness] this deployment is NOT the savageops fork build; '
      + 'old sessions carrying fork plugin events will fail with unknown-event-type refusals')
  }
}
