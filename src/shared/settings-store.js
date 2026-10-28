'use strict';

const fs = require('fs');
const path = require('path');
const { hotkeyEquals, validateHotkey } = require('./hotkey');

const DEFAULT_LOCK = { ctrl: true, alt: true, shift: false, win: false, key: 'K' };
const DEFAULT_UNLOCK = { ctrl: true, alt: true, shift: false, win: false, key: 'L' };

function defaultSettings() {
  return {
    version: 1,
    lockHotkey: Object.assign({}, DEFAULT_LOCK),
    unlockHotkey: Object.assign({}, DEFAULT_UNLOCK),
    tipSound: true,
    alwaysOnTop: true,
    widgetPosition: null
  };
}

function sanitizePosition(value) {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: x, y: y };
}

function distinctUnlock(lockHotkey, unlockHotkey) {
  if (!hotkeyEquals(lockHotkey, unlockHotkey)) return unlockHotkey;
  const fallback = unlockHotkey.key === 'L'
    ? { ctrl: true, alt: true, shift: false, win: false, key: 'K' }
    : Object.assign({}, DEFAULT_UNLOCK);
  if (!hotkeyEquals(lockHotkey, fallback)) return fallback;
  return { ctrl: true, alt: true, shift: true, win: false, key: 'L' };
}

/**
 * Persisted settings never include a lock flag. Boot must not restore a lock,
 * and login auto-start is not a feature.
 */
function sanitizeSettings(raw) {
  const defaults = defaultSettings();
  if (!raw || typeof raw !== 'object') return defaults;
  const lock = validateHotkey(raw.lockHotkey);
  const unlock = validateHotkey(raw.unlockHotkey);
  const lockHotkey = lock.ok ? lock.hotkey : defaults.lockHotkey;
  const unlockCandidate = unlock.ok ? unlock.hotkey : defaults.unlockHotkey;
  return {
    version: 1,
    lockHotkey: lockHotkey,
    unlockHotkey: distinctUnlock(lockHotkey, unlockCandidate),
    tipSound: typeof raw.tipSound === 'boolean' ? raw.tipSound : true,
    alwaysOnTop: typeof raw.alwaysOnTop === 'boolean' ? raw.alwaysOnTop : true,
    widgetPosition: sanitizePosition(raw.widgetPosition)
  };
}

function validateSettingsDraft(draft) {
  const lock = validateHotkey(draft && draft.lockHotkey);
  if (!lock.ok) return { ok: false, error: lock.error };
  const unlock = validateHotkey(draft && draft.unlockHotkey);
  if (!unlock.ok) return { ok: false, error: unlock.error };
  if (hotkeyEquals(lock.hotkey, unlock.hotkey)) {
    return { ok: false, error: '上锁和解锁不能用同一个组合键。' };
  }
  return {
    ok: true,
    settings: {
      lockHotkey: lock.hotkey,
      unlockHotkey: unlock.hotkey,
      tipSound: !!(draft && draft.tipSound),
      alwaysOnTop: typeof (draft && draft.alwaysOnTop) === 'boolean' ? draft.alwaysOnTop : true
    }
  };
}

function readSettings(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return defaultSettings();
  }
  try {
    return sanitizeSettings(JSON.parse(text));
  } catch (err) {
    try {
      fs.renameSync(filePath, filePath + '.bad');
    } catch (renameErr) {
      /* keep going with defaults */
    }
    return defaultSettings();
  }
}

function writeSettings(filePath, settings) {
  const clean = sanitizeSettings(settings);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
  return clean;
}

function createSettingsStore(filePath) {
  let data = readSettings(filePath);
  return {
    get() {
      return sanitizeSettings(data);
    },
    merge(partial) {
      data = writeSettings(filePath, Object.assign({}, data, partial || {}));
      return this.get();
    }
  };
}

module.exports = {
  DEFAULT_LOCK,
  DEFAULT_UNLOCK,
  defaultSettings,
  sanitizeSettings,
  validateSettingsDraft,
  readSettings,
  writeSettings,
  createSettingsStore
};
