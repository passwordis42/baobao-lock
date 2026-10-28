'use strict';

/**
 * Fallback when the native hook thread did not load.
 *
 * The hook is installed on the Electron main thread. The probe is injected
 * from a worker_thread (its own isolate, so SendInput does not hold the main
 * isolate) and this thread yields with setTimeout so Chromium's message loop,
 * not a koffi PeekMessage, dispatches the callback. v0.1.2 pumped inside
 * koffi and that callback never ran on the doctor's machine.
 *
 * If the probe still is not seen, the hook stays installed for a real key.
 */

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { createApiLoader } = require('./api-loader');
const {
  PROBE_EXTRA,
  PROBE_VK,
  INPUT_SIZE,
  isProbeEvent,
  writeKeyboardInputs,
  runYieldProbe
} = require('../shared/probe');

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

const WORKER_SOURCE = [
  "'use strict';",
  "const { parentPort, workerData } = require('worker_threads');",
  "const koffi = require(workerData.koffiPath);",
  "const user32 = koffi.load('user32.dll');",
  "const SendInput = user32.func('uint32 __stdcall SendInput(uint32 cInputs, void *pInputs, int cbSize)');",
  "const keybd_event = user32.func('void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr_t dwExtraInfo)');",
  "const buf = Buffer.from(workerData.inputs, 'base64');",
  "let sent = 0;",
  "let method = 'SendInput';",
  "try {",
  "  sent = Number(SendInput(workerData.count, buf, workerData.cbSize)) || 0;",
  "} catch (err) {",
  "  sent = 0;",
  "  method = 'sendinput-error';",
  "}",
  "if (sent !== workerData.count) {",
  "  try {",
  "    keybd_event(workerData.vk, 0, 0, workerData.extra);",
  "    keybd_event(workerData.vk, 0, 2, workerData.extra);",
  "    method = method === 'SendInput' ? 'keybd_event' : method;",
  "  } catch (err) {",
  "    method = 'keybd_event-error';",
  "  }",
  "}",
  "parentPort.postMessage({ injectMethod: method, sendInputCount: sent });"
].join('\n');

function asNumber(value) {
  if (typeof value === 'bigint') return Number(value);
  return Number(value);
}

function extraToString(extra) {
  try {
    return '0x' + BigInt(extra).toString(16);
  } catch (err) {
    return String(extra);
  }
}

function resolveKoffi() {
  const resolved = require.resolve('koffi');
  if (resolved.indexOf('app.asar') === -1) return resolved;
  const unpacked = resolved.replace(/app\.asar/g, 'app.asar.unpacked');
  if (fs.existsSync(unpacked)) return unpacked;
  return resolved;
}

function injectFromWorker() {
  return new Promise(function (resolve) {
    let settled = false;
    function finish(msg) {
      if (settled) return;
      settled = true;
      resolve(msg);
    }
    let worker;
    try {
      const { Worker } = require('worker_threads');
      worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: {
          koffiPath: resolveKoffi(),
          inputs: writeKeyboardInputs(PROBE_VK, PROBE_EXTRA).toString('base64'),
          count: 2,
          cbSize: INPUT_SIZE,
          vk: PROBE_VK,
          extra: PROBE_EXTRA
        }
      });
    } catch (err) {
      finish({
        injectMethod: 'error',
        sendInputCount: 0,
        error: err && err.message ? err.message : String(err)
      });
      return;
    }
    const timer = setTimeout(function () {
      finish({ injectMethod: 'timeout', sendInputCount: 0 });
      worker.terminate();
    }, 1600);
    worker.once('message', function (msg) {
      clearTimeout(timer);
      finish(msg || { injectMethod: 'none', sendInputCount: 0 });
    });
    worker.once('error', function (err) {
      clearTimeout(timer);
      finish({
        injectMethod: 'error',
        sendInputCount: 0,
        error: err && err.message ? err.message : String(err)
      });
    });
  });
}

function createKoffiBackend() {
  let SetWindowsHookExW = null;
  let CallNextHookEx = null;
  let UnhookWindowsHookEx = null;
  let GetLastError = null;
  let GetModuleHandleW = null;
  let GetModuleHandleName = null;
  let bound = false;
  let hHook = null;
  let callback = null;
  let handler = null;
  let probing = false;
  let probeSeen = false;
  let procEntered = 0;
  let decoded = 0;
  let lastVk = 0;
  let lastFlags = 0;
  let lastExtra = '0';
  const loadLibs = createApiLoader(function (name) { return koffi.load(name); });

  function ensureFns() {
    if (bound) return;
    const libs = loadLibs();
    SetWindowsHookExW = libs.user32.func(
      'void * __stdcall SetWindowsHookExW(int idHook, LowLevelProc *lpfn, void *hMod, uint32 dwThreadId)'
    );
    CallNextHookEx = libs.user32.func(
      'intptr_t __stdcall CallNextHookEx(void *hhk, int nCode, uintptr_t wParam, intptr_t lParam)'
    );
    UnhookWindowsHookEx = libs.user32.func('bool __stdcall UnhookWindowsHookEx(void *hhk)');
    GetLastError = libs.kernel32.func('uint32 __stdcall GetLastError()');
    GetModuleHandleW = libs.kernel32.func('void * __stdcall GetModuleHandleW(void *lpModuleName)');
    GetModuleHandleName = libs.kernel32.func('void * __stdcall GetModuleHandleW(str16 lpModuleName)');
    bound = true;
  }

  function clearCallback() {
    if (!callback) return;
    try { koffi.unregister(callback); } catch (err) { /* already gone */ }
    callback = null;
  }

  function proc(nCode, wParam, lParam) {
    procEntered += 1;
    try {
      if (asNumber(nCode) < 0) {
        return CallNextHookEx(hHook, nCode, wParam, lParam);
      }
      const kb = koffi.decode(lParam, KBDLLHOOKSTRUCT);
      decoded += 1;
      lastVk = asNumber(kb.vkCode);
      lastFlags = asNumber(kb.flags);
      lastExtra = extraToString(kb.dwExtraInfo);
      if (isProbeEvent(kb, probing)) {
        probeSeen = true;
        return 1;
      }
      const msg = asNumber(wParam);
      let phase = null;
      if (msg === WM_KEYDOWN || msg === WM_SYSKEYDOWN) phase = 'down';
      else if (msg === WM_KEYUP || msg === WM_SYSKEYUP) phase = 'up';
      if (!phase || !handler) return CallNextHookEx(hHook, nCode, wParam, lParam);
      if (handler(phase, lastVk)) return 1;
      return CallNextHookEx(hHook, nCode, wParam, lParam);
    } catch (err) {
      try {
        return CallNextHookEx(hHook, nCode, wParam, lParam);
      } catch (ignore) {
        return 0;
      }
    }
  }

  function hmodFor(kind) {
    if (kind === 'exe') return GetModuleHandleW(null);
    if (kind === 'addon') {
      try {
        const handle = GetModuleHandleName('koffi.node');
        if (handle) return handle;
      } catch (err) { /* try the documented NULL module */ }
      return undefined;
    }
    return null;
  }

  return {
    kind: 'koffi-main',
    nativeLoadError: '',
    setHandler(fn) { handler = fn; },
    setLocked() {},
    isAlive() { return !!hHook; },
    stats() {
      return {
        procEntered: procEntered,
        probeSeen: probeSeen,
        lastVk: lastVk,
        lastFlags: lastFlags,
        lastExtra: lastExtra,
        pump: 'yield'
      };
    },
    start(kind) {
      this.stop();
      ensureFns();
      const module = hmodFor(kind);
      if (kind === 'addon' && module === undefined) {
        return { ok: false, lastError: 0, hMod: 'addon' };
      }
      clearCallback();
      callback = koffi.register(proc, koffi.pointer(LowLevelProc));
      const handle = SetWindowsHookExW(WH_KEYBOARD_LL, callback, module, 0);
      if (!handle) {
        const code = GetLastError ? GetLastError() : 0;
        clearCallback();
        return { ok: false, lastError: Number(code) || 0, hMod: kind };
      }
      hHook = handle;
      return { ok: true, lastError: 0, hMod: kind, threadId: 0 };
    },
    probe() {
      const beforeEntered = procEntered;
      const beforeDecoded = decoded;
      probeSeen = false;
      probing = true;
      const state = {
        procAtStart: beforeEntered,
        get probeSeen() { return probeSeen; },
        get procEntered() { return procEntered; }
      };
      return runYieldProbe(state, {
        timeout: 1200,
        inject: injectFromWorker,
        wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
      }).then(function (yielded) {
        probing = false;
        const decodedDelta = decoded - beforeDecoded;
        const seen = probeSeen;
        return {
          proven: seen || decodedDelta > 0,
          probeSeen: seen,
          procEntered: procEntered,
          procDelta: procEntered - beforeEntered,
          lastVk: lastVk,
          lastFlags: lastFlags,
          lastExtra: lastExtra,
          sendInputCount: yielded.inject && yielded.inject.sendInputCount ? yielded.inject.sendInputCount : 0,
          injectMethod: yielded.inject && yielded.inject.injectMethod ? yielded.inject.injectMethod : '',
          yields: yielded.yields,
          pump: 'yield',
          elapsedMs: yielded.elapsedMs
        };
      }, function (err) {
        probing = false;
        throw err;
      });
    },
    stop() {
      probing = false;
      if (hHook && UnhookWindowsHookEx) {
        try { UnhookWindowsHookEx(hHook); } catch (err) { /* process exit still drops it */ }
      }
      hHook = null;
      clearCallback();
    }
  };
}

module.exports = {
  createKoffiBackend,
  KBDLLHOOKSTRUCT,
  WH_KEYBOARD_LL,
  resolveKoffi,
  WORKER_SOURCE
};
