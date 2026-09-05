# dsh-better-harness roadmap

Feature inventory and architecture decisions, grounded in the harness's real
extension surface (audited 2026-09-05 against dsh 0.1.3-alpha.1 source).

## The seam map (what a plugin can actually touch)

| Seam | Mechanism | Notes |
|---|---|---|
| `sidebar.workspaces` | single slot, **priority displacement** (lowest priority renders; upstream registers at default 0) | The entire browsing region: header, search, session list, workspace dialogs. Registering at priority −1 takes it over with zero upstream edits; removing the plugin restores upstream instantly. |
| `sidebar.footer.action` | list slot | Icon actions beside Settings — zero conflict, any number of plugins. |
| `sidebar.brand.mark` / `sidebar.brand.name` | single slots | Brand row replacement. |
| `settings.section` / `settings.plugins.tab` | list slots | Own Settings pages/tabs (ui-settings-plugins registers its pages this way — "feature plugins contribute pages without competing for Settings nav rows"). |
| `conversation.input.dock` | list slot (ordered) | Composer-adjacent dock entries (rich-tracking's scoreboard lives here at order 5). |
| Host settings namespaces | Service + schema, mounted via bundle-patch row | The durable user-preference lane — revisioned settings document, host-persisted, mirrored to clients. Template: tool-subagent's `model-selection-settings`. |
| Tools / session projections / `ctx.sessionEventTypes` | host plugin APIs | rich-tracking pattern. |
| No seam (stay in fork, in-tree) | — | Chat virtualization, tool-subagent selection engine, session-controller internals. |

## Decision: session management (the anchor feature)

**End state: this plugin owns the sidebar browsing region** by registering
`sidebar.workspaces` at priority −1 — a designed takeover mechanism, not a
fork. Upstream's browser stays mounted as the fallback; the plugin's browser
must reach feature parity before it may claim the seat.

**Persistence: the plugin's own DSH-home lane**
(`$DSH_HOME/better-harness/sessions.json`, atomic writes, one JSON document
through the domain model). The settings namespace lane was the first choice
but is injectively invisible to bundle-mounted user plugins in this cordis
build — `ctx.get('settings')` resolves while `ctx.inject(['settings'])`
never fires (statically declared or not), so no user plugin can register a
namespace today. If that boundary is fixed upstream, the store can migrate
documents into the settings lane unchanged; the domain model is identical.

### Phase 1 — foundation (this release, v0.2.0)
- Pure domain model for session metadata: favorites, pins, groups
  (create/rename/delete, membership), validation, and the sort/filter query
  combinators the UI will consume. Fully unit-tested (`src/session-meta.js`).
- Host store + routes over the file lane: GET state, POST one domain
  action, GET /list joining persistence headers. Loopback-fenced,
  live-verified end to end. Unit-tested (`src/sessions-store.js`).
- Roadmap + seam documentation (this file).

### Phase 2 — panel UI
- `sidebar.footer.action` entry (star icon) opening the Better Sessions
  panel: favorites list, group manager, bulk actions. Reads the session list
  through the public `sessions`/`workspaces` client services; writes through
  `settingsScope` bound to the plugin namespace.
- Client bundle follows the rich-tracking browser pattern
  (`window.__ModuleLoader__` IIFE; `react` and `@deepseek-ai/dsh-client-*`
  via the module registry's `require`).

### Phase 3 — the takeover
- Own `sidebar.workspaces` at priority −1 once at parity with upstream's
  browser (search, workspace dialogs, directory-flow hole, grouped/flat
  views). Then deliver the full management UX:
  - right-click context menu on sessions: favorite, pin, add/remove groups
  - favorites + pinned sections pinned above the tree
  - group-by-group view replacing the folder view, with per-group collapse
  - filters (group, favorite, recency) and stable custom ordering
- Long game: propose the row-level seam (context-menu + row-action slots)
  upstream; if merged, the browser retracts to those seams and upstream's
  browser returns.

## Broader catalog (post-sidebar candidates)

- **QoL**: session notes/tags surfaced in search; quick-switch palette
  (cmd-k style) over `conversation` surface; workspace health chips.
- **Performance**: idle-time session list prefetch warming (via public
  session remotes); projection cache advisor (surface cold sessions before
  first click).
- **UX**: brand-row slot customization (`sidebar.brand.*`); onboarding tour
  through the settings section slot.
- Each lands only through the seams above — never an in-tree patch.
