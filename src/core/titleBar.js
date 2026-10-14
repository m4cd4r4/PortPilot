/**
 * Colours for the Windows window buttons drawn over the PortPilot header. The OS wants
 * opaque #rrggbb values, but a theme's header colour can be translucent (Glass), so it
 * is composited over the page colour first. Loaded as a browser global
 * (window.PortPilotTitleBar) by the renderer and as CommonJS by tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PortPilotTitleBar = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** "rgb(1, 2, 3)" / "rgba(1, 2, 3, 0.5)" / "#abc" / "#aabbcc" -> { r, g, b, a } or null. */
  function parse(css) {
    const s = String(css || '').trim().toLowerCase();
    let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(s);
    if (m) {
      const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      return { r: +m[1], g: +m[2], b: +m[3], a };
    }
    m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }

  const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  const toHex = (c) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;

  /** fg drawn over an opaque bg. */
  function over(fg, bg) {
    return {
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    };
  }

  /**
   * { color, symbolColor } as #rrggbb, or null when a colour cannot be read.
   *   headerBg, pageBg, text: computed CSS colour strings.
   */
  function colorsFor({ headerBg, pageBg, text }) {
    const header = parse(headerBg);
    const page = parse(pageBg);
    const sym = parse(text);
    if (!header || !page || !sym) return null;
    const opaquePage = page.a >= 1 ? page : over(page, { r: 0, g: 0, b: 0, a: 1 });
    return { color: toHex(over(header, opaquePage)), symbolColor: toHex(over(sym, opaquePage)) };
  }

  return { parse, toHex, over, colorsFor };
});
