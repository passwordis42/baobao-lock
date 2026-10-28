'use strict';

/**
 * Low-level keyboard hook (WH_KEYBOARD_LL = 13).
 *
 * Windows calls the hook on the thread that installed it, and only while that
 * thread is inside PeekMessage / GetMessage / MsgWaitForMultipleObjects.
 * Electron pumps those messages when the main loop is idle, so a real key can
 * be swallowed before another program sees it.
 *
 * The install self-test used to call keybd_event on this same thread and read
 * a flag as soon as it returned. The callback had not run yet, so the flag
 * stayed false, install() removed a hook that would have worked, and the
 * keyboard never locked (probe-not-sync). The test key is now injected with
 * keybd_event.async (a worker thread) while this thread pumps. Success means
 * the hook observed that key. If it does not, the keyboard is not locked.
 *
 * Mouse / trackpad are never hooked.
 */

const koffi = require('koffi');
const { createApiLoader } = require('./api-loader');
const { pumpUntil, PM_NOREMOVE, QS_ALLINPUT, PROBE_PUMP_MS } = require('./message-pump');
const { describeHookException, describeWin32HookFailure } = require('../shared/messages');
const { isProbeEvent, runInstalledProbe } = require('../shared/probe');

const WH_KEYBOARD_LL = 13;
const WM_KEYDOWN = 0x0100;
const WM_KEYUP = 0x0101;
const WM_SYSKEYDOWN = 0x0104;
const WM_SYSKEYUP = 0x0105;

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

  let SetWindowsHookExW = null;
  let CallNextHookEx = null;
  let UnhookWindowsHookEx = null;
  let GetLastError = null;
  let keybd_event = null;
  let PeekMessageW = null;
  let MsgWaitForMultipleObjects = null;
  let Sleep = null;
  let bound = false;
  let hHook = null;
  let callback = null;
  let active = false;
  let probing = false;
  let probeSeen = false;
  const probeMsg = Buffer.alloc(64);
  const loadLibs = createApiLoader(function (name) { return koffi.load(name); });

  function loadApi() {
    const libs = loadLibs();
    if (bound) return libs.kernel32;
    SetWindowsHookExW = libs.user32.func(
      'void * __stdcall SetWindowsHookExW(int idHook, LowLevelProc *lpfn, void *hMod, uint32 dwThreadId)'
    );
    CallNextHookEx = libs.user32.func(
      'intptr_t __stdcall CallNextHookEx(void *hhk, int nCode, uintptr_t wParam, intptr_t lParam)'
    );
    UnhookWindowsHookEx = libs.user32.func('bool __stdcall UnhookWindowsHookEx(void *hhk)');
    keybd_event = libs.user32.func(
      'void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr_t dwExtraInfo)'
    );
    PeekMessageW = libs.user32.func(
      'int __stdcall PeekMessageW(void *lpMsg, void *hWnd, uint32 wMsgFilterMin, uint32 wMsgFilterMax, uint32 wRemoveMsg)'
    );
    MsgWaitForMultipleObjects = libs.user32.func(
      'uint32 __stdcall MsgWaitForMultipleObjects(uint32 nCount, void *pHandles, int fWaitAll, uint32 dwMilliseconds, uint32 dwWakeMask)'
    );
    GetLastError = libs.kernel32.func('uint32 __stdcall GetLastError()');
    Sleep = libs.kernel32.func('void __stdcall Sleep(uint32 dwMilliseconds)');
    bound = true;
    return libs.kernel32;
  }

  function proc(nCode, wParam, lParam) {
    try {
      if (asNumber(nCode) < 0) {
        return CallNextHookEx(hHook, nCode, wParam, lParam);
      }
      const kb = koffi.decode(lParam, KBDLLHOOKSTRUCT);
      if (isProbeEvent(kb, probing)) {
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

  function injectAsync(vk, scan, flags, extra) {
    keybd_event.async(vk, scan, flags, extra, function (err) {
      if (!err) return;
      try { onError(err); } catch (ignore) { /* probe result is what the user sees */ }
    });
  }

  function pumpProbe(pred) {
    return pumpUntil(pred, PROBE_PUMP_MS, {
      peek() { PeekMessageW(probeMsg, null, 0, 0, PM_NOREMOVE); },
      wait(ms) { MsgWaitForMultipleObjects(0, null, 0, ms, QS_ALLINPUT); },
      sleep(ms) { Sleep(ms); }
    });
  }

  function probe() {
    if (!hHook || !keybd_event || !PeekMessageW || !MsgWaitForMultipleObjects || !Sleep) {
      return { ok: false, code: 'probe-no-hook', detail: '钩子句柄无效。' };
    }
    // PeekMessage can deliver the hook (and other sent messages) before it
    // returns. A nested probe must not uninstall the hook still under test.
    if (probing) return { ok: true };
    probing = true;
    try {
      return runInstalledProbe(
        {
          get hHook() { return hHook; },
          get probeSeen() { return probeSeen; },
          set probeSeen(value) { probeSeen = !!value; }
        },
        {
          inject: injectAsync,
          pump: pumpProbe
        }
      );
    } finally {
      probing = false;
    }
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
          detail: describeWin32HookFailure(set.error)
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
        detail: describeHookException(err)
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
  createApiLoader,
  WH_KEYBOARD_LL,
  KBDLLHOOKSTRUCT
};
