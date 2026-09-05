/**
 * dsh-better-harness browser half: the Better Sessions panel.
 *
 * A `sidebar.footer.action` star entry opens a panel over the sidebar that
 * manages the session-organization document (favorites, pins, groups) over
 * the plugin's loopback routes. All state lives on the host in the settings
 * lane; this bundle only renders and dispatches actions.
 */
window.__ModuleLoader__.load({
	id: "dsh-better-harness",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		let react = require("react");
		let jsx = require("react/jsx-runtime");
		const { useEffect, useMemo, useRef, useState } = react;
		const h = jsx.jsx;

		const NS = "better-harness";
		const API = "/api/better-harness/sessions";

		const en = {
			"panel.title": "Better Sessions",
			"panel.intro": "Favorites, pins, and groups for your sessions.",
			"panel.close": "Close",
			"filter.all": "All",
			"filter.favorites": "Favorites",
			"sort.recency": "Recent",
			"sort.title": "Path",
			"group.new": "New group",
			"group.create": "Create",
			"group.delete": "Delete",
			"group.rename": "Rename",
			"group.empty": "No groups yet — create one to organize sessions.",
			"sessions.empty": "No sessions match this filter.",
			"row.favorite": "Toggle favorite",
			"row.pin": "Toggle pin",
			"row.groups": "Groups",
			"state.error": "Action failed",
		};
		const zh = {
			"panel.title": "会话管理",
			"panel.intro": "收藏、置顶与分组。",
			"panel.close": "关闭",
			"filter.all": "全部",
			"filter.favorites": "收藏",
			"sort.recency": "最近",
			"sort.title": "路径",
			"group.new": "新建分组",
			"group.create": "创建",
			"group.delete": "删除",
			"group.rename": "重命名",
			"group.empty": "还没有分组——创建一个来整理会话。",
			"sessions.empty": "没有符合筛选的会话。",
			"row.favorite": "收藏/取消",
			"row.pin": "置顶/取消",
			"row.groups": "分组",
			"state.error": "操作失败",
		};

		async function api(path, init) {
			const res = await fetch(`${API}${path ?? ""}`, { ...init, signal: AbortSignal.timeout(15_000) });
			const body = await res.json().catch(() => ({}));
			if (!res.ok || body.ok === false) throw new Error(body.error ?? `HTTP ${res.status}`);
			return body;
		}

		function relTime(value, now) {
			if (typeof value !== "number") return "";
			const seconds = Math.max(0, Math.round((now - value) / 1000));
			if (seconds < 60) return `${seconds}s`;
			if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
			if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
			return `${Math.round(seconds / 86400)}d`;
		}

		function basename(cwd) {
			if (typeof cwd !== "string" || cwd.length === 0) return "session";
			const parts = cwd.replace(/[\\/]+$/, "").split(/[\\/]/);
			return parts[parts.length - 1] || "session";
		}

		const StarIcon = ({ filled, size = 14 }) =>
			h("svg", { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true" }, h("path", {
				d: "M8 1.5l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.3l-3.8 2 .7-4.3-3.1-3 4.3-.6z",
				fill: filled ? "currentColor" : "none",
				stroke: "currentColor",
				strokeWidth: "1.2",
				strokeLinejoin: "round",
			}));
		const PinIcon = ({ filled, size = 14 }) =>
			h("svg", { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true" }, h("path", {
				d: "M9.5 1.5l5 5-2.2.6-2.6 2.6.3 3.3-1.9-1.6-3.4 3.4-.8-.8 3.4-3.4-1.6-1.9 3.3.3 2.6-2.6z",
				fill: filled ? "currentColor" : "none",
				stroke: "currentColor",
				strokeWidth: "1.1",
				strokeLinejoin: "round",
			}));

		function BetterSessionsPanel({ t, onClose }) {
			const [state, setState] = useState(null);
			const [sessions, setSessions] = useState([]);
			const [filter, setFilter] = useState({ kind: "all", group: undefined });
			const [order, setOrder] = useState("recency");
			const [groupName, setGroupName] = useState("");
			const [error, setError] = useState("");
			const [busy, setBusy] = useState(false);

			const refresh = () => api("/list").then((body) => { setState(body.state); setSessions(body.sessions); setError(""); })
				.catch((e) => setError(String(e.message ?? e)));

			useEffect(() => { refresh() }, []);

			const act = (action) => {
				setBusy(true);
				return api("", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) })
					.then((body) => setState(body.state))
					.then(() => refresh())
					.catch((e) => setError(String(e.message ?? e)))
					.finally(() => setBusy(false));
			};

			const groups = state ? Object.keys(state.groups) : [];
			const favoriteSet = useMemo(() => new Set(state?.favorites ?? []), [state]);
			const pinnedSet = useMemo(() => new Set(state?.pinned ?? []), [state]);
			const membership = useMemo(() => {
				const map = new Map();
				for (const name of groups) for (const id of state.groups[name]) {
					const list = map.get(id) ?? [];
					list.push(name);
					map.set(id, list);
				}
				return map;
			}, [state]);

			const now = Date.now();
			const rows = useMemo(() => {
				let list = sessions.map((s) => ({ ...s, pinned: pinnedSet.has(s.id), groups: membership.get(s.id) ?? [] }));
				if (filter.kind === "favorites") list = list.filter((s) => favoriteSet.has(s.id));
				if (filter.kind === "group") {
					const members = new Set(state?.groups[filter.group] ?? []);
					list = list.filter((s) => members.has(s.id));
				}
				list.sort((a, b) => {
					if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
					if (order === "title") return basename(a.cwd) < basename(b.cwd) ? -1 : basename(a.cwd) > basename(b.cwd) ? 1 : a.id < b.id ? -1 : 1;
					const at = typeof a.createdAt === "number" ? a.createdAt : -Infinity;
					const bt = typeof b.createdAt === "number" ? b.createdAt : -Infinity;
					if (at !== bt) return bt - at;
					return a.id < b.id ? -1 : 1;
				});
				return list;
			}, [sessions, favoriteSet, pinnedSet, membership, filter, order, state]);

			const chip = (active) => ({
				border: "none", borderRadius: 999, padding: "2px 10px", fontSize: 12, cursor: "pointer",
				background: active ? "var(--dsw-alias-accent, #4c7dff)" : "var(--dsw-alias-surface-l2, #eee)",
				color: active ? "#fff" : "inherit",
			});
			const iconButton = (label) => ({
				border: "none", background: "transparent", cursor: busy ? "wait" : "pointer", padding: 3,
				color: "var(--dsw-alias-text-2, #888)", borderRadius: 6,
			});

			return h("div", {
				style: { position: "fixed", inset: 0, zIndex: 90, display: "flex", alignItems: "flex-start", justifyContent: "flex-start", background: "rgba(0,0,0,0.25)" },
				onClick: (e) => { if (e.target === e.currentTarget) onClose() },
			},
				h("section", {
					role: "dialog", "aria-label": t("panel.title"),
					style: {
						margin: 48, width: 460, maxWidth: "calc(100vw - 96px)", maxHeight: "calc(100vh - 96px)", overflow: "auto",
						background: "var(--dsw-alias-surface-l1, #fff)", color: "inherit",
						border: "1px solid var(--dsw-alias-border-l1, #ddd)", borderRadius: 12, padding: 16, boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
					},
				},
					h("header", { style: { display: "flex", alignItems: "baseline", gap: 8 } },
						h("h2", { style: { margin: 0, fontSize: 15 } }, h(StarIcon, { filled: true }), " ", t("panel.title")),
						h("span", { style: { flex: 1, fontSize: 12, opacity: 0.7 } }, t("panel.intro")),
						h("button", { type: "button", style: { border: "none", background: "transparent", cursor: "pointer", fontSize: 14 }, onClick: onClose, "aria-label": t("panel.close") }, "✕"),
					),
					h("div", { style: { display: "flex", gap: 6, margin: "10px 0", flexWrap: "wrap", alignItems: "center" } },
						h("button", { type: "button", style: chip(filter.kind === "all"), onClick: () => setFilter({ kind: "all" }) }, t("filter.all")),
						h("button", { type: "button", style: chip(filter.kind === "favorites"), onClick: () => setFilter({ kind: "favorites" }) }, t("filter.favorites")),
						...groups.map((name) => h("button", {
							type: "button", key: name, style: chip(filter.kind === "group" && filter.group === name),
							onClick: () => setFilter({ kind: "group", group: name }),
						}, name)),
						h("span", { style: { flex: 1 } }),
						h("button", { type: "button", style: chip(order === "recency"), onClick: () => setOrder("recency") }, t("sort.recency")),
						h("button", { type: "button", style: chip(order === "title"), onClick: () => setOrder("title") }, t("sort.title")),
					),
					error ? h("p", { role: "alert", style: { color: "var(--dsw-alias-danger, #c33)", fontSize: 12, margin: "4px 0" } }, `${t("state.error")}: ${error}`) : null,
					h("ul", { style: { listStyle: "none", margin: 0, padding: 0 } },
						rows.length === 0 ? h("li", { style: { padding: 12, fontSize: 12, opacity: 0.7 } }, t("sessions.empty")) : null,
						rows.map((s) => h("li", {
							key: s.id,
							style: { display: "flex", alignItems: "center", gap: 6, padding: "6px 4px", borderBottom: "1px solid var(--dsw-alias-border-l1, #eee)" },
						},
							h("button", { type: "button", title: t("row.favorite"), "aria-label": t("row.favorite"), style: { ...iconButton(), color: favoriteSet.has(s.id) ? "var(--dsw-alias-warn, #e6a700)" : undefined }, onClick: () => act({ type: "toggle-favorite", sessionId: s.id }) }, h(StarIcon, { filled: favoriteSet.has(s.id) })),
							h("button", { type: "button", title: t("row.pin"), "aria-label": t("row.pin"), style: { ...iconButton(), color: s.pinned ? "var(--dsw-alias-accent, #4c7dff)" : undefined }, onClick: () => act({ type: "toggle-pin", sessionId: s.id }) }, h(PinIcon, { filled: s.pinned })),
							h("div", { style: { flex: 1, minWidth: 0 } },
								h("div", { style: { fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, basename(s.cwd)),
								h("div", { style: { fontSize: 11, opacity: 0.65 } },
									relTime(s.createdAt, now), s.eventCount !== undefined ? ` · ${s.eventCount} events` : "",
									s.groups.length > 0 ? ` · ${s.groups.join(", ")}` : "")),
							groups.length > 0 ? h("select", {
								"aria-label": t("row.groups"), value: "",
								style: { border: "1px solid var(--dsw-alias-border-l1, #ddd)", borderRadius: 6, background: "transparent", color: "inherit", fontSize: 11, padding: "2px 4px" },
								onChange: (e) => { const name = e.target.value; if (name) act({ type: "toggle-group-member", sessionId: s.id, group: name }); e.target.value = "" },
							},
								h("option", { value: "" }, t("row.groups")),
								groups.map((name) => h("option", { key: name, value: name }, `${s.groups.includes(name) ? "✓ " : ""}${name}`)),
							) : null,
						))),
					h("div", { style: { marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--dsw-alias-border-l1, #eee)" } },
						groups.length === 0 ? h("p", { style: { fontSize: 12, opacity: 0.7, margin: "0 0 6px" } }, t("group.empty")) : null,
						h("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } },
							groups.map((name) => h("span", { key: name, style: { display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid var(--dsw-alias-border-l1, #ddd)", borderRadius: 8, padding: "2px 6px", fontSize: 12 } },
								name,
								h("button", { type: "button", title: t("group.rename"), style: { border: "none", background: "transparent", cursor: "pointer", fontSize: 11 }, onClick: () => { const to = window.prompt(`${t("group.rename")}: ${name}`, name); if (to && to.trim() && to.trim() !== name) act({ type: "rename-group", from: name, to: to.trim() }) } }, "✎"),
								h("button", { type: "button", title: t("group.delete"), style: { border: "none", background: "transparent", cursor: "pointer", fontSize: 11 }, onClick: () => { if (window.confirm(`${t("group.delete")}: ${name}?`)) act({ type: "delete-group", group: name }) } }, "✕"),
							))),
						h("div", { style: { display: "flex", gap: 6, marginTop: 8 } },
							h("input", {
								value: groupName, placeholder: t("group.new"), "aria-label": t("group.new"),
								onChange: (e) => setGroupName(e.target.value),
								onKeyDown: (e) => { if (e.key === "Enter" && groupName.trim()) { act({ type: "create-group", group: groupName.trim() }); setGroupName("") } },
								style: { flex: 1, border: "1px solid var(--dsw-alias-border-l1, #ddd)", borderRadius: 6, padding: "4px 8px", background: "transparent", color: "inherit", fontSize: 12 },
							}),
							h("button", { type: "button", disabled: !groupName.trim(), style: { ...chip(false), opacity: groupName.trim() ? 1 : 0.5 }, onClick: () => { if (groupName.trim()) { act({ type: "create-group", group: groupName.trim() }); setGroupName("") } } }, t("group.create")),
						),
					),
				));
		}

		function FooterAction({ t: translate, wide }) {
			const t = (key) => translate?.(key) ?? key;
			const [open, setOpen] = useState(false);
			useEffect(() => {
				if (!open) return;
				const onKey = (e) => { if (e.key === "Escape") setOpen(false) };
				document.addEventListener("keydown", onKey, true);
				return () => document.removeEventListener("keydown", onKey, true);
			}, [open]);
			return h(react.Fragment, null,
				h("button", {
					type: "button", "aria-label": t("panel.title"), title: t("panel.title"),
					onClick: () => setOpen((v) => !v),
					style: {
						border: "none", background: "transparent", cursor: "pointer", borderRadius: 8, padding: 6,
						color: "var(--dsw-alias-text-2, #888)", display: "inline-flex", alignItems: "center",
					},
				}, h(StarIcon, { size: wide ? 15 : 18 })),
				open ? h(BetterSessionsPanel, { t, onClose: () => setOpen(false) }) : null);
		}

		const inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { en, zh }), "better-harness: dictionaries");
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "better-sessions",
				order: 10,
				locale: NS,
			}, FooterAction));
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
