'use strict';

/**
 * Scenes: a named set of registered apps and browser profiles started together.
 * Stored as config.scenes = [{ id, name, apps: [appId], browsers: [profileName] }].
 * This file is only the shape and its validation; starting and stopping use the existing
 * app and browser operations (the UI runs them one by one so each result can be reported).
 */

const MAX_SCENES = 50;
const MAX_MEMBERS = 100;
const NAME_MAX = 60;

const uniq = (list, max) => [...new Set((Array.isArray(list) ? list : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()))].slice(0, max);

/** A clean scene from untrusted input. Throws a plain-English error when it cannot be one. */
function normalizeScene(input) {
  const name = typeof input?.name === 'string' ? input.name.trim().slice(0, NAME_MAX) : '';
  if (!name) throw new Error('A scene needs a name');
  const apps = uniq(input.apps, MAX_MEMBERS);
  const browsers = uniq(input.browsers, MAX_MEMBERS);
  if (!apps.length && !browsers.length) throw new Error('A scene needs at least one app or browser profile');
  const id = typeof input.id === 'string' && /^scene_[A-Za-z0-9_]{1,40}$/.test(input.id)
    ? input.id
    : `scene_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return { id, name, apps, browsers };
}

/** Insert or replace by id; names are unique (case-insensitive) so the picker is never ambiguous. */
function upsertScene(scenes, input) {
  const next = normalizeScene(input);
  const list = Array.isArray(scenes) ? scenes : [];
  if (list.some((s) => s.id !== next.id && s.name.toLowerCase() === next.name.toLowerCase())) {
    throw new Error(`A scene called "${next.name}" already exists`);
  }
  const i = list.findIndex((s) => s.id === next.id);
  if (i < 0 && list.length >= MAX_SCENES) throw new Error(`At most ${MAX_SCENES} scenes`);
  const out = list.slice();
  if (i >= 0) out[i] = next; else out.push(next);
  return { scenes: out, scene: next };
}

/** Drop apps and profiles that no longer exist, so a stale scene never fails on a ghost. */
function pruneScene(scene, appIds, profileNames) {
  const a = new Set(appIds);
  const b = new Set(profileNames);
  return { ...scene, apps: scene.apps.filter((x) => a.has(x)), browsers: scene.browsers.filter((x) => b.has(x)) };
}

module.exports = { normalizeScene, upsertScene, pruneScene, MAX_SCENES };
