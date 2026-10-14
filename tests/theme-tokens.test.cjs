// Every theme block in styles.css defines the round 2 card tokens, so a new
// component can use var(--radius-card) etc. without a per-theme fallback.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
const THEMES = ['tokyonight', 'light', 'nord', 'dracula', 'glass'];
const TOKENS = ['--radius-card', '--elev-card', '--preview-aspect'];

for (const theme of THEMES) {
  const start = css.search(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{`));
  assert.ok(start >= 0, `theme block not found: ${theme}`);
  const block = css.slice(start, css.indexOf('}', start));
  for (const token of TOKENS) {
    assert.ok(new RegExp(`${token}\\s*:`).test(block), `${theme} is missing ${token}`);
  }
}

console.log(`theme-tokens: ${THEMES.length} themes x ${TOKENS.length} tokens ok`);
