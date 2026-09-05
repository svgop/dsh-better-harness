# dsh-better-harness

Fork-local capabilities for the [savageops deepseek-harness fork](https://github.com/svgop/deepseek-harness) — mounted as an ordinary DeepSeek Harness plugin, zero in-tree footprint.

## What it does today (v0.1.0)

**Fork compatibility guard.** The fork's harness carries read-path admissions that let old sessions open: fork event types in the static vocabulary, plugin event-type registration threaded through format migration, and tolerance for plugin-authored payload forms. A stock upstream harness silently refuses those sessions with `unknown event type` errors. On boot this plugin probes the harness it is mounted into — the static `KNOWN_SESSION_EVENT_TYPES` set and the `ctx.sessionEventTypes` registry surface — and logs one explicit verdict:

- `fork-compatible` — the mounted harness admits fork-written history.
- `STOCK-UPSTREAM-HARNESS` — it does not; old sessions carrying fork plugin events will refuse to open.

The point is operational: a wrong-harness deployment announces itself at startup instead of failing one session at a time.

## Charter — why this repo exists

Every feature here composes through the harness's **public seams** (slots like `settings.plugins.tab`, tool registration, `ctx.sessionEventTypes`, bundle-patch rows). The fork learned the hard way that invasive edits inside upstream packages cause heavy merge conflicts; features that live here merge trivially, because upstream never sees them.

The fork's classification, maintained in the harness repo's `dsh-upstream-sync` skill:

| Fork change | Home |
|---|---|
| New plugin-shaped features (tools, cards with own mounts, event registrations) | **this repo** |
| Read-path correctness fixes (session-format admission) | upstream PRs; in-tree until merged |
| Surgery with no public seam (ChatView virtualization, tool-subagent selection engine) | in-tree, rerere-managed |

## Install

The plugin mounts like any sibling: add it to the dsh profile's `package.json` dependencies and let its bundle patch (`cordis.patch.yml`, declared by `dsh.bundle.patch`) insert the row.

## Development

```sh
npm test   # node --test src/
```

Plain JavaScript, no build step. The host half is `src/host.js` (`export function apply(ctx)`); a browser half (`src/client.bundle.js`, `./client` export) joins when the first UI feature lands here.
