'use strict';

const { VK, MODIFIER_NAMES } = require('./keys');
const { formatCompact } = require('./format');

function anyModifier(mods) {
  return !!(mods && (mods.ctrl || mods.alt || mods.shift || mods.win));
}

function sameModifiers(a, b) {
  return !!a.ctrl === !!b.ctrl
    && !!a.alt === !!b.alt
    && !!a.shift === !!b.shift
    && !!a.win === !!b.win;
}

function normalizeHotkey(input) {
  if (!input || typeof input !== 'object') return null;
  if (typeof input.key !== 'string' || !Object.prototype.hasOwnProperty.call(VK, input.key)) return null;
  if (MODIFIER_NAMES.has(input.key)) return null;
  return {
    ctrl: !!input.ctrl,
    alt: !!input.alt,
    shift: !!input.shift,
    win: !!input.win,
    key: input.key
  };
}

function hotkeyEquals(a, b) {
  if (!a || !b) return false;
  return a.key === b.key && sameModifiers(a, b);
}

function hotkeyMatches(hotkey, mods, keyName) {
  if (!hotkey || !mods) return false;
  return hotkey.key === keyName && sameModifiers(hotkey, mods);
}

function validateHotkey(input) {
  const hotkey = normalizeHotkey(input);
  if (!hotkey) return { ok: false, error: '请使用支持的按键。' };
  if (hotkey.key === 'ESCAPE') {
    return { ok: false, error: 'Esc 留给紧急解锁（长按 3 秒），不能设成快捷键。' };
  }
  if (!anyModifier(hotkey)) {
    return { ok: false, error: '请至少带上一个修饰键（Ctrl、Alt、Shift 或 Win）。' };
  }
  if (hotkey.win && !hotkey.ctrl && !hotkey.alt && !hotkey.shift && hotkey.key === 'L') {
    return { ok: false, error: 'Win+L 由系统占用，拦不到，不能设成快捷键。' };
  }
  if (hotkey.ctrl && hotkey.alt && !hotkey.shift && !hotkey.win && hotkey.key === 'DELETE') {
    return { ok: false, error: 'Ctrl+Alt+Del 由系统占用，拦不到，不能设成快捷键。' };
  }
  return { ok: true, hotkey };
}

/**
 * A finished chord that looks like an unlock try, but is not the unlock chord
 * and is not the lock chord. Plain letters (no modifier) are not attempts.
 */
function isWrongUnlockAttempt(unlock, lock, mods, keyName) {
  if (!unlock || !mods || !keyName) return false;
  if (MODIFIER_NAMES.has(keyName)) return false;
  if (hotkeyMatches(unlock, mods, keyName)) return false;
  if (lock && hotkeyMatches(lock, mods, keyName)) return false;
  if (!anyModifier(mods)) return false;
  const same = sameModifiers(unlock, mods);
  if (same && keyName !== unlock.key) return true;
  if (keyName === unlock.key && !same) return true;
  return false;
}

function describeHotkey(hotkey) {
  return formatCompact(hotkey);
}

module.exports = {
  anyModifier,
  sameModifiers,
  normalizeHotkey,
  hotkeyEquals,
  hotkeyMatches,
  validateHotkey,
  isWrongUnlockAttempt,
  describeHotkey
};
