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
  /** What a folder name may be a copy of, longest first: `a-b-c` gives `a-b`, `a`. */
  const stems = (name) => {
    const out = [];
    for (let i = name.lastIndexOf('-'); i > 0; i = name.lastIndexOf('-', i - 1)) out.push(name.slice(0, i));
    return out;
  };

  /**
   * apps: the registered apps. roots: { appId: main repo folder } for the apps whose folder the
   * host could read. Returns { appId: { key, name } }; an app with no folder has no entry.
   * Order of evidence: the repo on disk, the parent app's project, a known repo that the folder
   * sits in or beside (`repo/web`, `repo-slug`), a repo named by a worktree-shaped pair of folders
   * (`shop/apps/web` and `shop-fix/apps/web`), the folder under a directory that holds known
   * repos, then the folder itself. Keys compare without case: Windows paths do.
   *
   * Every lookup walks one path against a Set, so the cost grows with the number of apps, not its
   * square: the page works this out again on each refresh.
   */
  function projectsOf(apps, roots) {
    const list = Array.isArray(apps) ? apps : [];
    const known = roots || {};
    const byId = new Map(list.map((a) => [a.id, a]));
    const shown = new Map(); // key -> the path as written, for the name
    const keyOf = (p) => { const n = norm(p); const k = n.toLowerCase(); if (k && !shown.has(k)) shown.set(k, n); return k; };
    // A path is cut by counting folders, never by string length: lower-casing can change the length.
    const firstFolders = (p, n) => norm(p).split('/').slice(0, n).join('/');

    const rootKeys = new Set();
    for (const a of list) if (known[a.id]) rootKeys.add(keyOf(known[a.id]));
    const holders = new Set([...rootKeys].map(dirOf).filter(Boolean));
    const cwdKeys = new Set();
    for (const a of list) { const k = keyOf(a.cwd); if (k) cwdKeys.add(k); }

    // With no repo read from disk, two apps in the same place under `shop` and `shop-fix` name the
    // repo: `shop`. Only a pair with folders below it counts; plain siblings are joined further down.
    const inferred = new Set();
    for (const a of list) {
      if (known[a.id]) continue;
      const parts = keyOf(a.cwd).split('/');
      for (let i = 1; i < parts.length - 1; i++) {
        for (const stem of stems(parts[i])) {
          const twin = [...parts.slice(0, i), stem, ...parts.slice(i + 1)].join('/');
          if (cwdKeys.has(twin)) inferred.add(keyOf(firstFolders(shown.get(twin), i + 1)));
        }
      }
    }

    /** The longest member of `set` that the folder is, sits inside, or sits beside as `name-...`. */
    const near = (cwd, set) => {
      if (!set.size) return '';
      const parts = cwd.split('/');
      for (let n = parts.length; n > 0; n--) {
        const head = n > 1 ? `${parts.slice(0, n - 1).join('/')}/` : '';
        if (set.has(head + parts[n - 1])) return head + parts[n - 1];
        for (const stem of stems(parts[n - 1])) if (set.has(head + stem)) return head + stem;
      }
      return '';
    };
    /** The folder directly under the nearest directory that holds known repos. */
    const underHolder = (a, cwd) => {
      const parts = cwd.split('/');
      for (let n = parts.length - 1; n > 0; n--) {
        if (holders.has(parts.slice(0, n).join('/'))) return keyOf(firstFolders(a.cwd, n + 1));
      }
      return '';
    };

    const done = new Map();
    const resolve = (a, seen) => {
      if (done.has(a.id)) return done.get(a.id);
      let key = '';
      if (known[a.id]) key = keyOf(known[a.id]);
      const parent = !key && a.parentId && !seen.has(a.parentId) ? byId.get(a.parentId) : null;
      if (parent) key = resolve(parent, new Set([...seen, a.id]));
      const cwd = key ? '' : keyOf(a.cwd);
      if (cwd) key = near(cwd, rootKeys) || near(cwd, inferred) || underHolder(a, cwd) || cwd;
      done.set(a.id, key);
      return key;
    };
    for (const a of list) resolve(a, new Set());

    // A guessed folder joins the project it sits beside: `shop-fix` goes with `shop`, and so does
    // `shop-fix-2`. Only a sibling joins: a folder inside another is left alone, or one app
    // registered at a parent directory would swallow every project under it. A repo read from disk
    // is never folded into its neighbour.
    const keys = new Set([...done.values()].filter(Boolean));
    const home = new Map();
    const joined = (key) => {
      if (rootKeys.has(key)) return key;
      if (home.has(key)) return home.get(key);
      const cut = key.lastIndexOf('/') + 1;
      const beside = stems(key.slice(cut)).map((s) => key.slice(0, cut) + s).find((k) => keys.has(k));
      const to = beside ? joined(beside) : key;
      home.set(key, to);
      return to;
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
   * The remembered last-run times brought up to date: the later of history and memory per app, and
   * only apps still registered. Null when there are no apps: before the app list has landed there
   * is nothing to prune against, and saving the result would wipe the memory.
   */
  function mergeLastRun(runs, remembered, apps) {
    const list = Array.isArray(apps) ? apps : [];
    if (!list.length) return null;
    const seen = lastRunByApp(runs);
    const old = remembered && typeof remembered === 'object' ? remembered : {};
    const out = {};
    for (const a of list) {
      const t = Math.max(seen[a.id] || 0, Number(old[a.id]) || 0);
      if (t) out[a.id] = t;
    }
    return out;
  }

  /** Reads history and merges it. Null, and nothing to save, when the read fails. */
  async function loadLastRun(read, getOld, getApps) {
    let h;
    try { h = await read(); } catch { return null; }
    return mergeLastRun(h && h.runs, getOld(), getApps());
  }

  /** The saved open/folded choices, less the sections that no longer exist. */
  function pruneOpen(saved, ids) {
    const keep = new Set(ids);
    const out = {};
    for (const [k, v] of Object.entries(saved && typeof saved === 'object' ? saved : {})) if (keep.has(k)) out[k] = !!v;
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

  return { projectsOf, sections, lastRunByApp, mergeLastRun, loadLastRun, pruneOpen, olderIds, OLDER_DAYS };
});
