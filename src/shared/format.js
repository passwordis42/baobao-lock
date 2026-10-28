'use strict';

/**
 * Hotkey display shared by the main process and the renderers.
 * Loaded as CJS from Node and as a classic script in the pages.
 */
(function exportFormat(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BaobaoFormat = api;
})(typeof window !== 'undefined' ? window : null, function factory() {
  const LABELS = {
    SPACE: 'Space',
    TAB: 'Tab',
    RETURN: 'Enter',
    BACK: 'Backspace',
    DELETE: 'Del',
    INSERT: 'Ins',
    HOME: 'Home',
    END: 'End',
    PRIOR: 'PgUp',
    NEXT: 'PgDn',
    LEFT: '←',
    RIGHT: '→',
    UP: '↑',
    DOWN: '↓',
    SNAPSHOT: 'PrtSc',
    PAUSE: 'Pause',
    CAPITAL: 'CapsLock',
    ESCAPE: 'Esc',
    OEM_MINUS: '-',
    OEM_PLUS: '=',
    OEM_COMMA: ',',
    OEM_PERIOD: '.',
    OEM_1: ';',
    OEM_2: '/',
    OEM_3: '`',
    OEM_4: '[',
    OEM_5: '\\',
    OEM_6: ']',
    OEM_7: "'",
    MULTIPLY: 'Num*',
    ADD: 'Num+',
    SUBTRACT: 'Num-',
    DECIMAL: 'Num.',
    DIVIDE: 'Num/',
    NUMLOCK: 'NumLock',
    SCROLL: 'ScrollLock',
    LWIN: 'Win',
    RWIN: 'Win'
  };

  for (let i = 0; i <= 9; i += 1) LABELS['NUMPAD' + i] = 'Num' + i;

  function labelFor(name) {
    if (!name) return '';
    return LABELS[name] || name;
  }

  function parts(hotkey) {
    const list = [];
    if (!hotkey) return list;
    if (hotkey.ctrl) list.push('Ctrl');
    if (hotkey.alt) list.push('Alt');
    if (hotkey.shift) list.push('Shift');
    if (hotkey.win) list.push('Win');
    if (hotkey.key) list.push(labelFor(hotkey.key));
    return list;
  }

  function formatSpaced(hotkey) {
    return parts(hotkey).join(' + ');
  }

  function formatCompact(hotkey) {
    return parts(hotkey).join('+');
  }

  /** Mock copy is 「1.8 / 3 秒」. */
  function formatHold(elapsedMs, totalMs) {
    const total = totalMs == null ? 3000 : totalMs;
    const clamped = Math.min(total, Math.max(0, Number(elapsedMs) || 0));
    const shown = (Math.round((clamped / 1000) * 10) / 10).toFixed(1);
    const totalSec = total / 1000;
    const totalText = Number.isInteger(totalSec) ? String(totalSec) : totalSec.toFixed(1);
    return shown + ' / ' + totalText + ' 秒';
  }

  return { labelFor, parts, formatSpaced, formatCompact, formatHold };
});
