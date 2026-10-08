/**
 * PortPilot mod: the auto-register composition, with its I/O injected.
 *
 * register.tsx hands in callers built on `$` (files, MCP tools, git, the
 * claim lock, a fresh config and port scan); tests/plugin-mod.test.mjs hands
 * in fakes, so CI runs the same wiring the hook runs.
 *
 * Contract: before the claim, any doubt returns undefined and the command
 * runs as written. From the claim on, nothing falls through to a shell
 * start: a registration that did not land, a start that failed and a throw
 * all end in a deny, because another call (or this one's detached spawn)
 * may already be starting the server.
 */
import { normPath, planAutoRegister, routeResult, startDir, worktreeParent } from './guard-core.mjs';

/** A UNC path (`//wsl.localhost/x`, `\\server\share`): normPath would fold it into a local one. */
export function isUncPath(p) {
  return /^[\\/]{2}[^\\/]/.test(String(p || ''));
}

/** A file-name-safe key for the claim on a directory (comparison form). */
export function claimKey(dir) {
  let h = 5381;
  for (const ch of String(dir)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return `dir-${h.toString(16)}`;
}

/** The new app's id from add_app / add_worktree's JSON reply, else its name. */
export function addedId(text, fallback) {
  try {
    const id = JSON.parse(String(text || '')).app?.id;
    if (typeof id === 'string' && id) return id;
  } catch { /* not JSON */ }
  return fallback;
}

function ownerOf(config, dir, windows) {
  return ((config && config.apps) || []).find((a) => a && a.cwd && normPath(a.cwd, { windows }) === dir) || null;
}

function reuseDeny(plan, owner) {
  const name = owner ? owner.name : plan.name;
  return {
    deny: `PortPilot: ${plan.cwd} was just registered as "${name}" by another call, and it is starting or running on :${plan.port}. Do not start a second copy; reuse http://localhost:${plan.port} and check it with PortPilot's get_status.`,
  };
}

/**
 * @param {object} io
 * @param {(path:string) => Promise<object|null>} io.readJson
 * @param {(path:string) => Promise<boolean>} io.exists
 * @param {(name:string) => Promise<string|null>} io.tool       full MCP tool name, or null
 * @param {(args:object) => Promise<{deny?:string, isError?:boolean, text?:string}>} io.call
 * @param {(cwd:string) => Promise<{gitDir:string|null, commonDir:string|null}>} io.gitDirs
 * @param {() => Promise<string>} io.sessionId
 * @param {(key:string) => Promise<'ok'|'busy'|'error'>} io.claim
 * @param {(key:string) => Promise<void>} io.release
 * @param {() => Promise<{config:object|null, listeners:Map|null}>} io.reread
 * @param {object} c  { start, dir, config, listeners, windows, home, sessionCwd }
 * @returns {Promise<undefined | {deny:string} | {result:object}>}
 */
export async function autoRegisterFlow(io, c) {
  let plan;
  let parent = null;
  let names;
  try {
    if (isUncPath(c.sessionCwd) || isUncPath(c.start.cd)) return undefined;
    const cwd = startDir(c.sessionCwd, c.start.cd, { windows: c.windows, home: c.home, keepCase: true });
    if (!(await io.exists(cwd))) return undefined;
    const [pkg, addApp, addWt, startApp] = await Promise.all([
      io.readJson(`${cwd}/package.json`), io.tool('add_app'), io.tool('add_worktree'), io.tool('start_app'),
    ]);
    plan = planAutoRegister({
      start: c.start, dir: c.dir, cwd, config: c.config, listeners: c.listeners, pkg, home: c.home,
      tools: { add: !!addApp, start: !!startApp }, windows: c.windows,
    });
    if (!plan) return undefined;
    if (addWt) parent = worktreeParent({ dir: c.dir, ...(await io.gitDirs(plan.cwd)), config: c.config, windows: c.windows });
    names = { addApp, addWt, startApp };
  } catch {
    return undefined;
  }

  const key = claimKey(c.dir);
  let claimed;
  try {
    claimed = await io.claim(key);
  } catch {
    claimed = 'error';
  }
  if (claimed === 'error') return undefined;
  if (claimed === 'busy') return reuseDeny(plan, null);

  try {
    // Serialised now: a call that held the claim before may have registered it.
    const fresh = await io.reread().catch(() => null);
    const before = fresh && ownerOf(fresh.config, c.dir, c.windows);
    if (before || (fresh && fresh.listeners && fresh.listeners.has(plan.port))) return reuseDeny(plan, before);

    let added;
    try {
      added = parent && names.addWt
        ? await io.call({ tool: names.addWt, path: plan.cwd, command: plan.command, preferredPort: plan.port, parent: parent.id })
        : await io.call({
            tool: names.addApp, name: plan.name, command: plan.command, cwd: plan.cwd, preferredPort: plan.port,
            description: 'Auto-registered from Claude Code',
          });
    } catch (err) {
      added = { isError: true, text: String((err && err.message) || err) };
    }
    if (!added || added.deny !== undefined || added.isError) {
      const after = await io.reread().catch(() => null);
      const owner = after && ownerOf(after.config, c.dir, c.windows);
      if (owner || (after && after.listeners && after.listeners.has(plan.port))) return reuseDeny(plan, owner);
      const why = added && added.deny !== undefined ? `was refused (${added.deny})` : `failed: ${(added && added.text) || 'no detail'}`;
      return { deny: `PortPilot: registering ${plan.cwd} in PortPilot ${why}, so the start did not run. Ask the user how they want it started.` };
    }

    const id = addedId(added.text, plan.name);
    const app = { id, name: parent ? parent.name : plan.name, cwd: plan.cwd, preferredPort: plan.port };
    let ran;
    try {
      ran = await io.call({ tool: names.startApp, identifier: id, sessionId: await io.sessionId() });
    } catch (err) {
      ran = { isError: true, text: String((err && err.message) || err) };
    }
    return routeResult({ app, port: plan.port, cd: c.start.cd, registered: true }, ran);
  } catch (err) {
    return { deny: `PortPilot: registering ${plan.cwd} stopped part way (${String((err && err.message) || err)}), so the start did not run. Check PortPilot's get_status before starting it.` };
  } finally {
    try { await io.release(key); } catch { /* a stale claim expires */ }
  }
}
