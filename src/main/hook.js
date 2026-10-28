'use strict';

/**
 * Keyboard hook facade.
 * On Windows this installs WH_KEYBOARD_LL. Anywhere else install() fails and
 * the process must not present a locked state.
 */
function createUnsupportedHook() {
  return {
    install() {
      return {
        ok: false,
        code: 'unsupported-platform',
        detail: '宝宝锁的键盘钩子只支持 Windows。'
      };
    },
    uninstall() {},
    isActive() {
      return false;
    },
    isInstalled() {
      return false;
    },
    isAwaitingProof() {
      return false;
    },
    isAlive() {
      return false;
    },
    armLock() {
      return 'absent';
    },
    giveUp() {
      return {
        ok: false,
        code: 'unsupported-platform',
        detail: '宝宝锁的键盘钩子只支持 Windows。'
      };
    },
    setLocked() {}
  };
}

function createHook(options) {
  if (process.platform !== 'win32') return createUnsupportedHook();
  const { createWinHook } = require('./hook-win');
  return createWinHook(options || {});
}

module.exports = { createHook, createUnsupportedHook };
