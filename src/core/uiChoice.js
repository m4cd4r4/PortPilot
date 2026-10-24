/**
 * Which renderer the main window loads: the redesign ("new", ui/ built to src/ui-dist) or the
 * v4 renderer ("classic", src/renderer). Pure; main.js supplies the facts.
 *
 * New is the default. A person switches with the in-app menu, which stores settings.ui; the
 * PORTPILOT_NEW_UI environment variable overrides it ('0' classic, '1' new) so tests and a
 * support session can pin one. A new UI that was never built falls back to classic: a package
 * missing src/ui-dist must still open.
 */

/**
 * @param {{ env?: string, setting?: string, built: boolean }} facts
 *   env: process.env.PORTPILOT_NEW_UI; setting: settings.ui; built: src/ui-dist/index.html exists
 * @returns {{ ui: 'new'|'classic', forced: boolean, missing: boolean }}
 *   forced: the environment decided, so the menu cannot change it; missing: new was wanted but is not built
 */
function chooseUi({ env, setting, built }) {
  const forced = env === '0' || env === '1';
  const want = forced ? (env === '1' ? 'new' : 'classic') : (setting === 'classic' ? 'classic' : 'new');
  if (want === 'new' && !built) return { ui: 'classic', forced, missing: true };
  return { ui: want, forced, missing: false };
}

module.exports = { chooseUi };
