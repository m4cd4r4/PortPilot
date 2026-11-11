/**
 * Pure model for the Apps page at scale: which project each app belongs to, the sections the
 * page draws, and which apps are old enough to fold away.
 *
 * A project is a repo folder. A repo and its worktrees are one project: the host reads the main
 * repo from disk where the folder still exists (`roots`), and the rest is worked out from paths,
 * because a registered worktree often outlives its folder. A guess can be wrong (two repos named
 * `shop` and `shop-admin` read as one), so an app put in a group by hand always goes to that group.
 *
 * Loaded as a browser global (window.PortPilotProjects) by the UI and as a CommonJS module by tests.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PortPilotProjects = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  // The browser global first: a bundler can define `module` in the page, where there is no require.
  const clusters = () => {
    if (root && root.PortPilotClusters) return root.PortPilotClusters;
    return require('./appClusters');
  };

  const DAY_MS = 24 * 60 * 60 * 1000;
  const OLDER_DAYS = 30;

  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const leaf = (p) => norm(p).split('/').pop() || '';
  const dirOf = (p) => { const i = p.lastIndexOf('/'); return i > 0 ? p.slice(0, i) : ''; };
  const longest = (list) => list.sort((a, b) => b.length - a.length)[0];

  /**
   * apps: the registered apps. roots: { appId: main repo folder } for the apps whose folder the
   * host could read. Returns { appId: { key, name } }; an app with no folder has no entry.
   * Order of evidence: the repo on disk, the parent app's project, a known repo that the folder
   * sits in or beside (`repo/web`, `repo-slug`), the folder under a directory that holds known
   * repos, then the folder itself. Keys compare without case: Windows paths do.
   */
  function projectsOf(apps, roots) {
    const list = Array.isArray(apps) ? apps : [];
    const known = roots || {};
    const byId = new Map(list.map((a) => [a.id, a]));
    const shown = new Map(); // key -> the path as written, for the name
    const keyOf = (p) => { const n = norm(p); const k = n.toLowerCase(); if (k && !shown.has(k)) shown.set(k, n); return k; };

    const rootKeys = new Set();
    for (const a of list) if (known[a.id]) rootKeys.add(keyOf(known[a.id]));
    const rootList = [...rootKeys].sort((a, b) => b.length - a.length);
    const holders = [...new Set(rootList.map(dirOf).filter(Boolean))].sort((a, b) => b.length - a.length);

    const done = new Map();
    const resolve = (a, seen) => {
      if (done.has(a.id)) return done.get(a.id);
      let key = '';
      if (known[a.id]) key = keyOf(known[a.id]);
      const parent = !key && a.parentId && !seen.has(a.parentId) ? byId.get(a.parentId) : null;
      if (parent) key = resolve(parent, new Set([...seen, a.id]));
      const cwd = key ? '' : keyOf(a.cwd);
      if (cwd) {
        key = rootList.find((m) => cwd === m || cwd.startsWith(`${m}/`) || cwd.startsWith(`${m}-`)) || '';
        if (!key) {
          const holder = holders.find((h) => cwd.startsWith(`${h}/`));
          key = holder ? keyOf(`${shown.get(holder) || holder}/${norm(a.cwd).slice(holder.length + 1).split('/')[0]}`) : cwd;
        }
      }
      done.set(a.id, key);
      return key;
    };
    for (const a of list) resolve(a, new Set());

    // A guessed folder joins the project it sits beside: `shop-fix` goes with `shop`. Only a sibling
    // joins: a folder inside another is left alone, or one app registered at a parent directory
    // would swallow every project under it.
    const keys = new Set([...done.values()].filter(Boolean));
    const joined = (key) => {
      if (rootKeys.has(key)) return key;
      return longest([...keys].filter((o) => o !== key && key.startsWith(`${o}-`) && !key.slice(o.length).includes('/'))) || key;
    };

    const out = {};
    for (const a of list) {
      const key = done.get(a.id) ? joined(done.get(a.id)) : '';
      if (key) out[a.id] = { key, name: leaf(shown.get(key) || key) };
    }
    return out;
  }

  const groupOf = (app) => app.group || app.groupId || '';

  /**
   * Cards in, page sections out: [{ id, name, kind, cards, active }].
   * - An app in a group (set by hand) goes to that group.
   * - Otherwise it goes to its project, when the project has two or more rows to show.
   *   A project named like a group joins that group.
   * - Everything else lands in one last section: "Other", or "All apps" when it is the only one.
   * Sections with something running or crashed come first, "Other" included; then groups in their
   * saved order, projects by name, and "Other" last.
   */
  function sections(cards, groups, projects) {
    const list = Array.isArray(cards) ? cards : [];
    const gs = Array.isArray(groups) ? groups : [];
    const proj = projects || {};
    const byGroup = new Map(gs.map((g) => [g.id, []]));
    const groupByName = new Map(gs.map((g) => [String(g.name || '').trim().toLowerCase(), g.id]));
    const byProject = new Map();
    const rest = [];
    for (const c of list) {
      const g = groupOf(c.app);
      if (g && byGroup.has(g)) { byGroup.get(g).push(c); continue; }
      const p = proj[c.app.id];
      if (!p) { rest.push(c); continue; }
      const named = groupByName.get(p.name.toLowerCase());
      if (named) { byGroup.get(named).push(c); continue; }
      if (!byProject.has(p.key)) byProject.set(p.key, { name: p.name, cards: [] });
      byProject.get(p.key).cards.push(c);
    }
    const isActive = (cs) => cs.some((c) => c.state !== 'stopped');
    const out = [];
    for (const g of gs) {
      const cs = byGroup.get(g.id);
      if (cs.length) out.push({ id: g.id, name: g.name, kind: 'group', cards: cs, active: isActive(cs) });
    }
    const projectRows = [];
    for (const [key, p] of byProject) {
      if (clusters().clusterCards(p.cards).length < 2) { rest.push(...p.cards); continue; }
      projectRows.push({ id: `p:${key}`, name: p.name, kind: 'project', cards: p.cards, active: isActive(p.cards) });
    }
    projectRows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    out.push(...projectRows);
    if (rest.length) {
      // The single apps keep the order the cards came in (best state first, then name).
      const order = new Map(list.map((c, i) => [c.app.id, i]));
      rest.sort((a, b) => order.get(a.app.id) - order.get(b.app.id));
      out.push({ id: '', name: out.length ? 'Other' : 'All apps', kind: 'rest', cards: rest, active: isActive(rest) });
    }
    // Array.prototype.sort is stable: within "active" and within "quiet" the order above is kept.
    return out.sort((a, b) => Number(b.active) - Number(a.active));
  }

  /** Latest start or stop per app, in ms, from run history: { appId: ms }. */
  function lastRunByApp(runs) {
    const out = {};
    for (const r of Array.isArray(runs) ? runs : []) {
      if (!r || !r.appId) continue;
      const t = Math.max(Date.parse(r.startedAt) || 0, Date.parse(r.stoppedAt) || 0);
      if (t > (out[r.appId] || 0)) out[r.appId] = t;
    }
    return out;
  }

  /**
   * Ids of the cards to fold under "Show older": stopped, and neither run nor added in the last
   * `days`. Adding counts, so an app registered yesterday is not hidden before its first run.
   * An app with no run and no added date is left alone: nothing says how old it is.
   * The copies of one app (a row on the page) go together: while any copy is recent or up, the old
   * copies stay folded inside that row instead of turning up again under "older".
   */
  function olderIds(cards, lastRun, now, days) {
    const out = new Set();
    const limit = (days == null ? OLDER_DAYS : days) * DAY_MS;
    const runs = lastRun || {};
    const isOld = (c) => {
      if (c.state !== 'stopped') return false;
      const t = Math.max(runs[c.app.id] || 0, Date.parse(c.app.createdAt) || 0);
      return t > 0 && now - t >= limit;
    };
    for (const row of clusters().clusterCards(Array.isArray(cards) ? cards : [])) {
      if (row.members.every(isOld)) for (const m of row.members) out.add(m.app.id);
    }
    return out;
  }

  return { projectsOf, sections, lastRunByApp, olderIds, OLDER_DAYS };
});
