'use strict';

/**
 * Cache user32 and kernel32 across install attempts.
 *
 * The previous loader did `if (user32) return;`, which returns undefined.
 * The next install then crashed on `kernel32.func` with
 * "Cannot read properties of undefined (reading 'func')".
 * That dialog looked like a hook failure, but it was this JS bug on retry
 * (tray lock, or the startup probe path calling install again).
 */
function createApiLoader(loadDll) {
  let user32 = null;
  let kernel32 = null;

  return function loadApi() {
    if (user32 && kernel32
        && typeof user32.func === 'function'
        && typeof kernel32.func === 'function') {
      return { user32: user32, kernel32: kernel32 };
    }
    try {
      if (!user32) user32 = loadDll('user32.dll');
      if (!kernel32) kernel32 = loadDll('kernel32.dll');
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      throw new Error('加载 user32.dll / kernel32.dll 失败：' + message);
    }
    if (!user32 || typeof user32.func !== 'function'
        || !kernel32 || typeof kernel32.func !== 'function') {
      user32 = null;
      kernel32 = null;
      throw new Error('系统库已加载，但 koffi 没有提供 func，无法绑定 Win32 函数。键盘没有锁住。');
    }
    return { user32: user32, kernel32: kernel32 };
  };
}

module.exports = { createApiLoader };
