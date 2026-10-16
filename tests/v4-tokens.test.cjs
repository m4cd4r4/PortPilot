// v4 slice 0: styles-v4.css is inert unless html[data-ui="v4"] (flag-off proof), both
// themes define the same token set, and the text pairs meet WCAG AA.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..', 'src', 'renderer');
const css = fs.readFileSync(path.join(root, 'styles-v4.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
// Drop @media openers so the rules inside are checked like any other; the stray closing
// braces they leave behind are skipped by the rule regex.
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');

// 1. Flag-off proof: every selector in the file is scoped under the flag.
const rules = [...stripped.matchAll(/([^{}]+)\{[^{}]*\}/g)];
assert.ok(rules.length >= 3, 'expected at least the two theme blocks and the settings rule');
for (const [, sel] of rules) {
  // Split on commas outside parentheses so :has(a, b) stays in one selector.
  for (const one of sel.split(/,(?![^(]*\))/)) {
    assert.ok(one.trim().startsWith('html[data-ui="v4"]'), `unscoped selector: ${one.trim()}`);
  }
}
assert.ok(/href="styles-v4\.css"/.test(html), 'index.html must link styles-v4.css');

// 2. Both themes define the same tokens.
function block(theme) {
  const m = stripped.match(new RegExp(`body\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`));
  assert.ok(m, `missing theme block ${theme}`);
  const tokens = {};
  for (const [, k, v] of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[k] = v.trim();
  return tokens;
}
const dark = block('v4-dark');
const light = block('v4-light');
assert.deepStrictEqual(Object.keys(dark).sort(), Object.keys(light).sort(), 'dark and light token sets differ');
const REQUIRED = ['--bg-primary', '--bg-secondary', '--bg-tertiary', '--text-primary', '--text-secondary',
  '--text-muted', '--accent-primary', '--accent-green', '--accent-red', '--accent-yellow', '--border-color',
  '--radius', '--radius-card', '--elev-card', '--preview-aspect', '--v4-on-accent'];
for (const t of REQUIRED) assert.ok(t in dark, `missing ${t}`);

// 3. WCAG AA (4.5:1) for text on its surfaces and for text on the accent.
const lum = hex => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const PAIRS = [
  ['--text-primary', '--bg-primary'], ['--text-primary', '--bg-secondary'],
  ['--text-secondary', '--bg-primary'], ['--text-secondary', '--bg-secondary'],
  ['--text-muted', '--bg-primary'], ['--text-muted', '--bg-secondary'],
  ['--accent-primary', '--bg-primary'], ['--accent-primary', '--bg-secondary'],
  ['--accent-red', '--bg-secondary'], ['--accent-yellow', '--bg-secondary'], ['--accent-green', '--bg-secondary'],
  ['--v4-on-accent', '--accent-primary'],
];
for (const [name, set] of [['dark', dark], ['light', light]]) {
  for (const [fg, bg] of PAIRS) {
    const r = ratio(set[fg], set[bg]);
    assert.ok(r >= 4.5, `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs 4.5`);
  }
}

console.log(`v4-tokens: ${rules.length} scoped rules, ${Object.keys(dark).length} tokens x 2 themes, ${PAIRS.length * 2} AA pairs ok`);

// 4. The web portal strips the v4 scripts, so the flag must stay off whenever the portal's token meta is present.
const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');
const flagBlock = rendererSrc.slice(rendererSrc.indexOf('const UI_V4 = (() => {'));
assert.ok(flagBlock.indexOf(`meta[name="pp-token"]`) > -1 && flagBlock.indexOf(`meta[name="pp-token"]`) < flagBlock.indexOf('localStorage.setItem'),
  'UI_V4 must return false in the web portal before it reads or writes the flag');
