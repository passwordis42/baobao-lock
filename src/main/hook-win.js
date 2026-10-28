'use strict';

/**
 * Low-level keyboard hook (WH_KEYBOARD_LL = 13).
 *
 * The hook callback runs on this process's UI thread. It must decide to
 * swallow the key before returning — if the callback were deferred to a later
 * turn of the event loop, the key would already have been delivered and a
 * locked widget would be a lie. install() sends a probe key and only reports
 * success when that key is observed inside the callback before keybd_event
 * returns.
 *
 * Mouse / trackpad are never hooked.
 */

const koffi = require('koffi');
const { PROBE_EXTRA, isProbeExtra } = require('../shared/probe');

const WH_KEYBOARD_LL = 13;
const WM_KEYDOWN = 0x0100;
const WM_KEYUP = 0x0101;
const WM_SYSKEYDOWN = 0x0104;
const WM_SYSKEYUP = 0x0105;
const KEYEVENTF_KEYUP = 0x0002;
const PROBE_VK = 0x86; // F23, not a real keyboard key on typical hardware

const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
  vkCode: 'uint32',
  scanCode: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr_t'
});

const LowLevelProc = koffi.proto(
  'intptr_t __stdcall LowLevelProc(int nCode, uintptr_t wParam, intptr_t lParam)'
);

function asNumber(value) {
  if (typeof value === 'bigint') return Number(value);
  return Number(value);
}

function createWinHook(options) {
  const decide = options.decide;
  const onError = options.onError || function () {};

  let user32 = null;
  let SetWindowsHookExW = null;
  let CallNextHookEx = null;
  let UnhookWindowsHookEx = null;
  let GetLastError = null;
  let keybd_event = null;
  let hHook = null;
  let callback = null;
  let active = false;
  let probeSeen = false;

  function loadApi() {
    if (user32) return;
    user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    SetWindowsHookExW = user32.func(
      'void * __stdcall SetWindowsHookExW(int idHook, LowLevelProc *lpfn, void *hMod, uint32 dwThreadId)'
    );
    CallNextHookEx = user32.func(
      'intptr_t __stdcall CallNextHookEx(void *hhk, int nCode, uintptr_t wParam, intptr_t lParam)'
    );
    UnhookWindowsHookEx = user32.func('bool __stdcall UnhookWindowsHookEx(void *hhk)');
    keybd_event = user32.func(
      'void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr_t dwExtraInfo)'
    );
    GetLastError = kernel32.func('uint32 __stdcall GetLastError()');
    return kernel32;
  }

  function proc(nCode, wParam, lParam) {
    try {
      if (asNumber(nCode) < 0) {
        return CallNextHookEx(hHook, nCode, wParam, lParam);
      }
      const kb = koffi.decode(lParam, KBDLLHOOKSTRUCT);
      if (isProbeExtra(kb.dwExtraInfo)) {
        probeSeen = true;
        return 1;
      }
      const msg = asNumber(wParam);
      let phase = null;
      if (msg === WM_KEYDOWN || msg === WM_SYSKEYDOWN) phase = 'down';
      else if (msg === WM_KEYUP || msg === WM_SYSKEYUP) phase = 'up';
      if (!phase) return CallNextHookEx(hHook, nCode, wParam, lParam);
      const decision = decide({
        phase: phase,
        vk: asNumber(kb.vkCode),
        now: Date.now()
      });
      if (decision && decision.swallow) return 1;
      return CallNextHookEx(hHook, nCode, wParam, lParam);
    } catch (err) {
      try { onError(err); } catch (ignore) { /* keep the hook alive */ }
      try {
        return CallNextHookEx(hHook, nCode, wParam, lParam);
      } catch (ignore) {
        return 0;
      }
    }
  }

  function clearCallback() {
    if (!callback) return;
    try { koffi.unregister(callback); } catch (err) { /* already gone */ }
    callback = null;
  }

  function uninstall() {
    active = false;
    if (hHook && UnhookWindowsHookEx) {
      try { UnhookWindowsHookEx(hHook); } catch (err) { /* process exit still drops it */ }
    }
    hHook = null;
    clearCallback();
  }

  function trySetHook(hMod) {
    clearCallback();
    callback = koffi.register(proc, koffi.pointer(LowLevelProc));
    const handle = SetWindowsHookExW(WH_KEYBOARD_LL, callback, hMod, 0);
    if (!handle) {
      const code = GetLastError ? GetLastError() : 0;
      clearCallback();
      return { handle: null, error: code };
    }
    return { handle: handle, error: 0 };
  }

  function probe() {
    if (!hHook || !keybd_event) {
      return { ok: false, code: 'probe-no-hook', detail: '钩子句柄无效。' };
    }
    probeSeen = false;
    keybd_event(PROBE_VK, 0, 0, PROBE_EXTRA);
    const sawDown = probeSeen;
    probeSeen = false;
    keybd_event(PROBE_VK, 0, KEYEVENTF_KEYUP, PROBE_EXTRA);
    if (!sawDown) {
      return {
        ok: false,
        code: 'probe-not-sync',
        detail: '钩子没有在按键到达其他程序之前同步拦住测试按键，因此不能用来上锁。'
      };
    }
    return { ok: true };
  }

  function install() {
    try {
      uninstall();
      const kernel32 = loadApi();
      const GetModuleHandleW = kernel32.func('void * __stdcall GetModuleHandleW(void *lpModuleName)');
      const hMod = GetModuleHandleW(null);
      let set = trySetHook(hMod);
      if (!set.handle) set = trySetHook(null);
      if (!set.handle) {
        return {
          ok: false,
          code: 'set-hook-failed',
          detail: 'SetWindowsHookExW 失败（错误码 ' + set.error + '）。'
        };
      }
      hHook = set.handle;
      const probed = probe();
      if (!probed.ok) {
        uninstall();
        return probed;
      }
      active = true;
      return { ok: true };
    } catch (err) {
      uninstall();
      return {
        ok: false,
        code: 'hook-exception',
        detail: err && err.message ? String(err.message) : String(err)
      };
    }
  }

  return {
    install: install,
    probe: probe,
    uninstall: uninstall,
    isActive() { return active && !!hHook; }
  };
}

module.exports = {
  createWinHook,
  WH_KEYBOARD_LL,
  KBDLLHOOKSTRUCT
};
