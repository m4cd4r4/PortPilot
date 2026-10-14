/**
 * Pure model for the home "Now running" strip: which apps get a card and in what
 * order. Loaded as a browser global (window.PortPilotNowStrip) by the renderer,
 * which runs without Node, and as a CommonJS module by tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PortPilotNowStrip = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HOME_LAYOUTS = ['classic', 'preview'];

  /** The saved homeLayout, or 'preview' (the default) for anything unset or unknown. */
  function homeLayoutOf(settings) {
    const v = settings && settings.homeLayout;
    return HOME_LAYOUTS.includes(v) ? v : 'preview';
  }

  /**
   * Cards for every registered app that is running (started by PortPilot) or
   * detected on its port, latest started first. An app whose start time is not
   * known sorts after those that have one, then by name, so the order is stable.
   *   in:  { apps, runningApps, detectedApps }   (the renderer's state slices)
   *   out: [{ id, name, port, branch, color, managed, ipv6Only, startedAt }]
   */
  function runningCards({ apps = [], runningApps = [], detectedApps = {} }) {
    const cards = [];
    for (const app of apps) {
      const managed = runningApps.find((r) => r.id === app.id && r.running);
      const detected = detectedApps[app.id];
      if (!managed && !detected) continue;
      const startedAt = managed && managed.startTime ? Date.parse(managed.startTime) : NaN;
      cards.push({
        id: app.id,
        name: app.name,
        port: (managed && managed.port) ?? (detected && detected.port) ?? app.preferredPort ?? null,
        branch: app.branch || '',
        color: app.color || '',
        managed: !!managed,
        ipv6Only: !!(detected && String(detected.address || '').startsWith('[')),
        startedAt: Number.isFinite(startedAt) ? startedAt : null,
      });
    }
    return cards.sort((a, b) => {
      if (a.startedAt != null && b.startedAt != null && a.startedAt !== b.startedAt) return b.startedAt - a.startedAt;
      if ((a.startedAt == null) !== (b.startedAt == null)) return a.startedAt == null ? 1 : -1;
      return String(a.name).localeCompare(String(b.name));
    });
  }

  /**
   * Why a card has no page preview, in words: null when a preview is shown.
   * IPv6-only servers are never captured today, so they say so rather than
   * waiting forever; anything else is "not captured yet".
   */
  function noPreviewReason(card, hasPreview, previewsOn = true) {
    if (hasPreview) return null;
    if (!previewsOn) return 'Previews are off in Settings';
    return card.ipv6Only ? 'No preview (IPv6 only)' : 'No preview yet';
  }

  return { HOME_LAYOUTS, homeLayoutOf, runningCards, noPreviewReason };
});
