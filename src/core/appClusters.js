/**
 * Pure model for the Apps page: folds the worktree copies of one project into a single
 * cluster so 130 registered apps read as the ~60 projects they really are. A worktree is
 * registered as its own app named after its parent ("Examworthy Web (main)") and differs
 * only by branch, so name and parentId decide the cluster. Loaded as a browser global
 * (window.PortPilotClusters) by the UI and as a CommonJS module by tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PortPilotClusters = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const RANK = { conflict: 0, crashed: 1, running: 2, stopped: 3 };
  const rank = (state) => (state in RANK ? RANK[state] : 3);

  /** "Examworthy Web (main)" -> "Examworthy Web". A name that is only a bracket is left alone. */
  function baseName(name) {
    const base = String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    return base || String(name || '');
  }

  const label = (c) => c.app.branch || c.app.name;
  const byLabel = (a, b) => rank(a.state) - rank(b.state) || label(a).localeCompare(label(b));

  /**
   * Cards in, clusters out: [{ key, name, head, state, members }]. Members keep every card of
   * the cluster, best state first. A cluster of one is just that app under its own name.
   * Clusters sort best state first, then by name, like the flat card list.
   */
  function clusterCards(cards) {
    const list = Array.isArray(cards) ? cards : [];
    const byId = new Map(list.map((c) => [c.app.id, c]));
    const parents = new Set(list.map((c) => c.app.parentId).filter(Boolean));
    const groups = new Map();
    for (const c of list) {
      const parent = c.app.parentId ? byId.get(c.app.parentId) : null;
      const key = baseName((parent || c).app.name).toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    const out = [];
    for (const [key, members] of groups) {
      members.sort(byLabel);
      const best = rank(members[0].state);
      // Among equally good members the copy the others hang off leads, so a calm cluster shows the main one.
      const tier = (m) => (parents.has(m.app.id) ? 0 : m.app.parentId ? 2 : 1);
      const head = members.filter((m) => rank(m.state) === best).sort((a, b) => tier(a) - tier(b))[0];
      out.push({
        key,
        name: members.length > 1 ? baseName(head.app.name) : head.app.name,
        head,
        state: head.state,
        members,
      });
    }
    return out.sort((a, b) => rank(a.state) - rank(b.state) || a.name.localeCompare(b.name));
  }

  return { clusterCards, baseName };
});
