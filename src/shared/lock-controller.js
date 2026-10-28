'use strict';

const { VK, vkToName, isModifierName } = require('./keys');
const { hotkeyMatches, isWrongUnlockAttempt } = require('./hotkey');
const { sanitizeSettings } = require('./settings-store');

const EMERGENCY_MS = 3000;
const HOLD_LOCK_MS = 3000;

function modsFromHeld(held) {
  const has = function (name) { return held.has(VK[name]); };
  return {
    ctrl: has('LCONTROL') || has('RCONTROL') || has('CONTROL'),
    alt: has('LMENU') || has('RMENU') || has('MENU'),
    shift: has('LSHIFT') || has('RSHIFT') || has('SHIFT'),
    win: has('LWIN') || has('RWIN')
  };
}

function createLockController(options) {
  let settings = sanitizeSettings(options && options.settings);
  let hookActive = false;
  let locked = false;
  let capture = null;
  let escSince = null;
  let holdSince = null;
  let holdVk = null;
  const held = new Set();
  const swallowedDown = new Set();

  function clearHold() {
    holdSince = null;
    holdVk = null;
  }

  function engage(via) {
    clearHold();
    if (!hookActive) {
      return { ok: false, actions: [{ type: 'hook-missing' }] };
    }
    if (!locked) {
      locked = true;
      escSince = null;
      return { ok: true, actions: [{ type: 'locked', via: via }] };
    }
    return { ok: true, actions: [] };
  }

  function release(via) {
    clearHold();
    if (!locked) return { actions: [] };
    locked = false;
    escSince = null;
    return { actions: [{ type: 'unlocked', via: via }] };
  }

  function bareKey(mods) {
    return !(mods.ctrl || mods.alt || mods.shift || mods.win);
  }

  function isHoldKey(name, mods) {
    const hold = settings.holdLockKey;
    if (!hold || !name || isModifierName(name)) return false;
    return name === hold.key && bareKey(mods);
  }

  function onDown(vk, now) {
    const name = vkToName(vk);
    const repeat = held.has(vk);
    held.add(vk);

    if (!name) {
      if (locked) {
        swallowedDown.add(vk);
        return { swallow: true, actions: [] };
      }
      return { swallow: false, actions: [] };
    }

    if (repeat) {
      const swallow = locked || swallowedDown.has(vk);
      if (swallow) swallowedDown.add(vk);
      return { swallow: swallow, actions: [] };
    }

    const mods = modsFromHeld(held);
    const actions = [];
    const capturing = capture;

    if (locked && !isModifierName(name) && hotkeyMatches(settings.unlockHotkey, mods, name)) {
      capture = null;
      const released = release('hotkey');
      if (capturing) released.actions.push({ type: 'capture-cancel' });
      swallowedDown.add(vk);
      return { swallow: true, actions: released.actions };
    }

    if (capturing && name === 'ESCAPE') {
      capture = null;
      actions.push({ type: 'capture-cancel' });
      if (!locked) {
        swallowedDown.add(vk);
        return { swallow: true, actions: actions };
      }
    } else if (capturing === 'hold' && !isModifierName(name)) {
      const hotkey = {
        ctrl: !!mods.ctrl,
        alt: !!mods.alt,
        shift: !!mods.shift,
        win: !!mods.win,
        key: name
      };
      capture = null;
      swallowedDown.add(vk);
      return {
        swallow: true,
        actions: [{ type: 'capture', target: 'hold', hotkey: hotkey }]
      };
    } else if (capturing && !isModifierName(name) && (mods.ctrl || mods.alt || mods.shift || mods.win)) {
      const hotkey = {
        ctrl: mods.ctrl,
        alt: mods.alt,
        shift: mods.shift,
        win: mods.win,
        key: name
      };
      const target = capture;
      capture = null;
      swallowedDown.add(vk);
      return {
        swallow: true,
        actions: [{ type: 'capture', target: target, hotkey: hotkey }]
      };
    }

    if (!locked) {
      if (holdVk != null && vk !== holdVk) {
        clearHold();
        actions.push({ type: 'hold-cancel' });
      }
      if (!isModifierName(name) && hotkeyMatches(settings.lockHotkey, mods, name)) {
        const engaged = engage('hotkey');
        swallowedDown.add(vk);
        return { swallow: true, actions: actions.concat(engaged.actions) };
      }
      if (!capturing && isHoldKey(name, mods)) {
        holdSince = now;
        holdVk = vk;
        actions.push({ type: 'hold-lock', elapsed: 0 });
        return { swallow: false, actions: actions };
      }
      return { swallow: false, actions: actions };
    }

    if (name === 'ESCAPE') {
      escSince = now;
      actions.push({ type: 'emergency', progress: 0, elapsed: 0 });
      swallowedDown.add(vk);
      return { swallow: true, actions: actions };
    }

    if (!isModifierName(name) && isWrongUnlockAttempt(settings.unlockHotkey, settings.lockHotkey, mods, name)) {
      actions.push({ type: 'wrong-attempt' });
    }

    swallowedDown.add(vk);
    return { swallow: true, actions: actions };
  }

  function onUp(vk) {
    const name = vkToName(vk);
    held.delete(vk);
    const actions = [];
    if (name === 'ESCAPE' && escSince != null) {
      escSince = null;
      if (locked) actions.push({ type: 'emergency-cancel' });
    }
    if (vk === holdVk && holdSince != null) {
      clearHold();
      actions.push({ type: 'hold-cancel' });
    }
    const swallow = swallowedDown.has(vk);
    swallowedDown.delete(vk);
    return { swallow: swallow, actions: actions };
  }

  return {
    EMERGENCY_MS: EMERGENCY_MS,
    HOLD_LOCK_MS: HOLD_LOCK_MS,

    event(input) {
      const vk = typeof input.vk === 'bigint' ? Number(input.vk) : Number(input.vk);
      const now = Number.isFinite(input.now) ? input.now : 0;
      if (input.phase === 'down') return onDown(vk, now);
      if (input.phase === 'up') return onUp(vk);
      return { swallow: false, actions: [] };
    },

    tick(now) {
      if (locked && escSince != null) {
        const elapsed = now - escSince;
        if (elapsed >= EMERGENCY_MS) {
          locked = false;
          escSince = null;
          clearHold();
          return { type: 'unlocked', via: 'emergency', progress: 1, elapsed: EMERGENCY_MS };
        }
        return { type: 'emergency', progress: elapsed / EMERGENCY_MS, elapsed: elapsed };
      }
      if (!locked && holdSince != null && now - holdSince >= HOLD_LOCK_MS) {
        const vk = holdVk;
        const engaged = engage('hold');
        if (engaged.ok && locked && vk != null) swallowedDown.add(vk);
        return engaged.actions[0] || null;
      }
      return null;
    },

    needsTick() {
      return (locked && escSince != null) || (!locked && holdSince != null);
    },

    emergencyView(now) {
      if (!locked || escSince == null) return null;
      const elapsed = Math.max(0, now - escSince);
      return { elapsed: elapsed, progress: Math.min(1, elapsed / EMERGENCY_MS) };
    },

    requestLock() {
      return engage('request');
    },

    requestUnlock() {
      return Object.assign({ ok: true }, release('request'));
    },

    setHookActive(active) {
      const next = !!active;
      const actions = [];
      if (hookActive && !next && locked) {
        locked = false;
        escSince = null;
        clearHold();
        capture = null;
        actions.push({ type: 'force-unlocked', reason: 'hook-lost' });
      }
      hookActive = next;
      if (!hookActive) {
        capture = null;
        clearHold();
      }
      return actions;
    },

    setCapture(which) {
      if (which === 'lock' || which === 'unlock' || which === 'hold' || which === null) {
        capture = which;
        if (which) clearHold();
      }
    },

    updateSettings(next) {
      const previous = settings.holdLockKey && settings.holdLockKey.key;
      settings = sanitizeSettings(Object.assign({}, settings, next || {}));
      if (!settings.holdLockKey || settings.holdLockKey.key !== previous) clearHold();
    },

    getState() {
      return {
        locked: locked,
        hookActive: hookActive,
        capture: capture,
        emergency: escSince == null ? null : { startedAt: escSince },
        hold: holdSince == null ? null : { startedAt: holdSince },
        settings: {
          lockHotkey: Object.assign({}, settings.lockHotkey),
          unlockHotkey: Object.assign({}, settings.unlockHotkey),
          holdLockKey: Object.assign({}, settings.holdLockKey),
          tipSound: settings.tipSound,
          alwaysOnTop: settings.alwaysOnTop,
          widgetPosition: settings.widgetPosition ? Object.assign({}, settings.widgetPosition) : null
        }
      };
    }
  };
}

module.exports = {
  EMERGENCY_MS,
  HOLD_LOCK_MS,
  createLockController
};
