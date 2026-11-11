/**
 * Real-Electron check of the Apps screen with a big library, against a THROWAWAY config:
 * apps group by project folder (a repo and its worktree are one project), quiet sections start
 * folded, apps not run in 30 days sit under "Show older", and every count on the page counts apps.
 * Run: npm run build:ui && node tests/redesign-apps-scale.e2e.js
 * Set PORTPILOT_SHOTS_DIR to save screenshots at 1440 and 390 wide.
 */
const h = require('./e2e-harness');
const { fs, path, until } = h;

const { check, finish } = h.checker();
const world = h.makeWorld('pp-scale-');
const SHOTS = process.env.PORTPILOT_SHOTS_DIR || '';
const DAY = 24 * 3600 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

async function main() {
  if (!fs.existsSync(path.join(h.root, 'src', 'ui-dist', 'index.html'))) throw new Error('src/ui-dist is missing; run "npm run build:ui" first');
  const [toolPort] = await h.freePorts(1);
  process.env.PORTPILOT_DETECT_ONLY_PORTS = String(toolPort);

  // A repo with a linked worktree beside it: three apps, one project.
  const shop = world.mkdir('shop');
  fs.mkdirSync(path.join(shop, 'web'));
  fs.mkdirSync(path.join(shop, 'api'));
  fs.writeFileSync(path.join(shop, 'web', 'index.html'), 'shop');
  fs.writeFileSync(path.join(shop, 'api', 'index.js'), '// api');
  h.git(shop, 'init', '-q');
  h.git(shop, 'add', '-A');
  h.git(shop, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
  const shopFix = path.join(world.tmp, 'shop-fix');
  h.git(shop, 'worktree', 'add', '-q', shopFix, '-b', 'fix');
  // Two apps in one plain folder: a project with no repo.
  const blog = world.mkdir('blog');
  fs.mkdirSync(path.join(blog, 'site'));
  fs.mkdirSync(path.join(blog, 'admin'));

  const idle = 'node server.js --portpilot-test --port 1';
  const apps = [
    { id: 'shop_web', name: 'Shop Web', command: idle, cwd: path.join(shop, 'web'), createdAt: ago(5) },
    { id: 'shop_api', name: 'Shop API', command: idle, cwd: path.join(shop, 'api'), createdAt: ago(5) },
    { id: 'shop_fix', name: 'Shop Web (fix)', command: idle, cwd: path.join(shopFix, 'web'), createdAt: ago(5) },
    { id: 'blog_site', name: 'Blog Site', command: idle, cwd: path.join(blog, 'site'), createdAt: ago(5) },
    { id: 'blog_admin', name: 'Blog Admin', command: idle, cwd: path.join(blog, 'admin'), createdAt: ago(5) },
  ];
  // Forty single apps. tool-00 really runs. 00, 01 and 03-09 are old: added 45 or 90 days ago and
  // not run since. tool-02 is as old but ran two days ago, so it stays.
  for (let i = 0; i < 40; i++) {
    const name = `tool-${String(i).padStart(2, '0')}`;
    const dir = world.mkdir(name);
    fs.writeFileSync(path.join(dir, 'server.js'), h.SERVER);
    apps.push({
      id: `tool_${i}`, name, cwd: dir,
      command: i === 0 ? `node server.js --portpilot-test --port ${toolPort}` : idle,
      ...(i === 0 ? { preferredPort: toolPort } : {}),
      createdAt: i < 3 ? ago(90) : i < 10 ? ago(45) : ago(5),
    });
  }
  world.writeConfig({ apps });
  const run = (id, appId, startDays, stopDays) => ({
    id, appId, appName: appId, cwd: null, command: idle, port: null, repoRoot: null, relCwd: null, url: null,
    startedBy: { kind: 'human', surface: 'desktop' }, startedAt: ago(startDays), stoppedAt: ago(stopDays), endedBy: 'stop', exitCode: null,
    git: { branch: null, sha: null, subject: null, dirty: false, files: [], snapshot: null, skipped: 'not-a-repo' }, page: null, pinned: false,
  });
  fs.mkdirSync(path.join(world.configDir, 'history'), { recursive: true });
  fs.writeFileSync(path.join(world.configDir, 'history', 'runs.json'), JSON.stringify({ v: 1, runs: [run('r_seed_0001', 'tool_1', 40, 39.9), run('r_seed_0002', 'tool_2', 2, 1.9)] }));
  const OLD = 9;

  const { app, win } = await h.launch(world, { width: 1440, height: 900 });
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const cards = () => win.locator('.gallery-view .card:not(.member)').count();
  const heads = () => win.locator('.gallery-view h3.group-h').evaluateAll((els) => els.map((e) => e.textContent));
  const sec = (name) => win.locator(`.gallery-view section[aria-label="${name}"]`);
  const fold = (name) => sec(name).locator('h3 .fold');
  const olderLine = () => win.locator('.show-all.older').textContent().catch(() => '');
  const shot = async (name) => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const w of [1440, 390]) {
      await win.setViewportSize({ width: w, height: 900 });
      await win.screenshot({ path: path.join(SHOTS, `apps-scale-${name}-${w}.png`) });
    }
    await win.setViewportSize({ width: 1440, height: 900 });
  };
  const openApps = async () => {
    await until(() => win.locator('.topbar').count().then((n) => n === 1), 20000, 'top bar');
    await win.click('role=tab[name="Apps"]');
    await until(async () => (await heads()).length >= 3, 15000, 'section headings').catch(async (e) => {
      throw new Error(`${e.message}: ${(await heads()).join(' | ')} / ${errors.join(' | ').slice(0, 600)}`);
    });
  };

  try {
    await openApps();
    console.log('step: sections by project folder');
    await until(async () => (await olderLine()).includes(`${OLD} apps`), 15000, 'the older line');
    const first = await heads();
    check('a repo and its worktree are one project, a plain folder is another, single apps are Other',
      first.join(' | ') === 'blog2 | shop3 | Other31', first.join(' | '));
    check('with nothing running in a big library every section starts folded', (await cards()) === 0 && (await win.locator('.gallery-view section[data-open="true"]').count()) === 0, `${await cards()} cards`);
    check('the older apps are one line, with their count', (await olderLine()).includes(`${OLD} apps not run in 30 days`), await olderLine());
    await shot('folded');

    console.log('step: open a project');
    await fold('shop').click();
    await until(async () => (await cards()) === 2, 5000, 'two rows');
    check('opening shop shows its two rows', true);
    check('the worktree copy is folded into its app', (await sec('shop').locator('.copies').textContent()).includes('2 copies'));
    check('the heading says it is open', (await fold('shop').getAttribute('aria-expanded')) === 'true');
    const controls = await fold('shop').getAttribute('aria-controls');
    check('and names the region it opens', !!controls && (await sec('shop').locator(`[id="${controls}"] .card`).count()) > 0, String(controls));
    // A choice saved for a section that is gone (a project whose apps were removed) is forgotten at the next click.
    await win.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('portpilot-apps-open') || '{}');
      localStorage.setItem('portpilot-apps-open', JSON.stringify({ ...saved, 'p:d:/gone/project': true }));
    });
    await win.reload();
    await openApps();
    await until(async () => (await cards()) === 2, 10000, 'shop still open');
    check('an opened section stays open after a reload', (await sec('shop').getAttribute('data-open')) === 'true');
    await fold('shop').click();
    await until(async () => (await cards()) === 0, 5000, 'folded again');
    const savedOpen = await win.evaluate(() => JSON.parse(localStorage.getItem('portpilot-apps-open') || '{}'));
    check('a saved choice for a section that no longer exists is dropped', !('p:d:/gone/project' in savedOpen) && Object.keys(savedOpen).length === 1, JSON.stringify(savedOpen));

    console.log('step: counts agree');
    await fold('Other').click();
    await until(async () => (await cards()) === 12, 5000, 'capped list');
    check('Other shows 12 stopped apps and offers the rest by the same number as its heading', (await win.locator('role=button[name="Show all 31 stopped apps"]').count()) === 1);
    await win.click('role=button[name="Show all 31 stopped apps"]');
    await until(async () => (await cards()) === 31, 5000, 'all 31');
    check('Show all reveals exactly that many', true);
    const focusRow = await win.evaluate(() => {
      const card = document.activeElement && document.activeElement.closest('.card');
      return card ? [...card.parentElement.querySelectorAll(':scope > article')].indexOf(card) : -1;
    });
    check('focus moves to the first app it revealed', focusRow === 12, `row ${focusRow}`);
    check('an app that ran two days ago is not old, whenever it was added', (await win.locator('.card[data-app="tool_2"]').count()) === 1);
    check('the old apps are not in the list', (await win.locator('.card[data-app="tool_1"], .card[data-app="tool_5"]').count()) === 0);

    console.log('step: show older');
    const showOlder = () => win.getByRole('button', { name: /^Show older/ });
    check('the Show older button is named with its count', (await win.getByRole('button', { name: `Show older: ${OLD} apps not run in 30 days`, exact: true }).count()) === 1);
    await showOlder().click();
    await until(() => sec('Older').count().then((n) => n === 1), 5000, 'Older section');
    check('Show older lists every old app', (await sec('Older').locator('.card').count()) === OLD, String(await sec('Older').locator('.card').count()));
    check('its heading carries the same count', (await sec('Older').locator('h3').textContent()).startsWith(`Older${OLD}`), await sec('Older').locator('h3').textContent());
    check('focus moves to the Older heading', await sec('Older').locator('h3').evaluate((el) => el === document.activeElement));
    check('Hide sits beside the heading, not inside it', (await sec('Older').locator('h3 button').count()) === 0);
    await shot('older');
    await sec('Older').getByRole('button', { name: 'Hide' }).click();
    await until(() => sec('Older').count().then((n) => n === 0), 5000, 'Older hidden');
    check('Hide folds them back', (await olderLine()).includes(`${OLD} apps`));
    check('and focus returns to Show older', await showOlder().evaluate((el) => el === document.activeElement));

    console.log('step: a filter finds an old app');
    await win.fill('input[aria-label="Filter apps"]', 'tool-05');
    await until(async () => (await win.locator('.card[data-app="tool_5"]').count()) === 1, 5000, 'filter result');
    check('the filter finds an old app without Show older', (await cards()) === 1 && (await win.locator('.show-all.older').count()) === 0);
    // A filter opens every section, so a click on a heading changes nothing and must save nothing.
    const filtered = (await heads()).map((t) => t.replace(/\d+.*$/, ''))[0];
    const before = await win.evaluate(() => localStorage.getItem('portpilot-apps-open'));
    check('the heading is marked as not foldable during a filter', (await fold(filtered).getAttribute('aria-disabled')) === 'true');
    await fold(filtered).click({ force: true }); // forced: the button says it is disabled, and the handler must agree
    check('a heading clicked during a filter saves no fold', (await win.evaluate(() => localStorage.getItem('portpilot-apps-open'))) === before && (await cards()) === 1, filtered);
    await win.fill('input[aria-label="Filter apps"]', '');
    await until(async () => (await olderLine()).includes(`${OLD} apps`), 5000, 'older line back');

    console.log('step: running an old app brings it back');
    await showOlder().click();
    const tool0 = win.locator('.card[data-app="tool_0"]');
    await tool0.hover();
    await tool0.getByRole('button', { name: 'Start' }).click();
    await until(async () => (await tool0.getAttribute('data-state')) === 'running', 30000, 'tool-00 running');
    await until(async () => (await sec('Older').locator('.card').count()) === OLD - 1, 10000, 'one fewer old app');
    check('a running app leaves Older', (await sec('Older').locator('.card[data-app="tool_0"]').count()) === 0);
    const live = await heads();
    check('the section with something running comes first and is open', live[0].startsWith('Other32') && (await sec('Other').getAttribute('data-open')) === 'true', live.join(' | '));
    const stoppedHead = await sec('Other').locator('h4.group-h.sub').textContent();
    check('Other 32 is the 1 running plus Stopped 31', stoppedHead === 'Stopped31', stoppedHead);
    await shot('running');
    await tool0.hover();
    await tool0.getByRole('button', { name: 'Stop' }).click();
    await until(async () => (await tool0.getAttribute('data-state')) === 'stopped', 30000, 'tool-00 stopped');
    await h.sleep(6500); // one full refresh, so a wrong fold would have happened by now
    check('after it stops it stays out of Older: it ran today', (await sec('Older').locator('.card[data-app="tool_0"]').count()) === 0 && (await sec('Other').locator('.card[data-app="tool_0"]').count()) === 1);
    await win.reload();
    await openApps();
    await until(async () => (await olderLine()).includes(`${OLD - 1} apps`), 15000, 'older count after reload');
    check('and that holds after a reload', true);

    console.log('step: flat list');
    await win.click('role=button[name="Grouped"]');
    await until(async () => (await win.locator('.gallery-view h3.group-h').count()) === 0, 5000, 'flat');
    check('ungrouped: one capped list, the old apps still folded', (await cards()) === 12 && (await olderLine()).includes(`${OLD - 1} apps`), `${await cards()} cards`);
    const all = await win.locator('role=button[name^="Show all"]').textContent();
    // 37 rows stopped: 36 single apps and projects, plus Shop Web holding its copy = 37 apps... counted as apps.
    check('Show all counts apps: 45 registered less 8 old', all === 'Show all 37 stopped apps', all);
    await win.click('role=button[name="Grouped"]');

    check('no console errors', errors.length === 0, errors.join(' | '));
  } finally {
    await h.closeApp(app);
  }
}

main().then(() => process.exit(finish() ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
