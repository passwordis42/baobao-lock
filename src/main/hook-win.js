'use strict';

/**
 * Keyboard hook for Windows.
 *
 * v0.1.2 still reported probe-not-sync on a real Windows 10 machine. koffi
 * really does run an async keybd_event on a libuv worker, but the installing
 * thread pumped with a synchronous koffi PeekMessage / MsgWait. The low-level
 * hook is only delivered while that thread is in a message wait, and koffi
 * cannot run the JS callback there: either the callback is nested in koffi's
 * private stack, or it is bounced through napi_call_threadsafe_function and
 * the main thread never drains it because it is blocked inside the pump.
 * install() then unhooked, so real keys were never tested.
 *
 * v0.1.3 installs WH_KEYBOARD_LL on a dedicated native thread that blocks in
 * GetMessageW / DispatchMessageW. The probe is SendInput (keybd_event only if
 * SendInput returns short) on a second thread, recognized in native code.
 * hMod is tried as the addon DLL, then NULL (the documented in-process value),
 * then the exe. A hook that never sees the synthetic key stays installed and
 * is proved by the first real key. Nothing is shown as locked until a key has
 * actually entered the hook procedure. If that never happens, the hook is
 * removed and the failure dialog stays honest.
 *
 * Mouse / trackpad are never hooked.
 */

const fs = require('fs');
const path = require('path');
const { describeHookException, describeWin32HookFailure } = require('../shared/messages');
const {
  HMOD_ORDER,
  PROBE_NOT_SYNC_DETAIL,
  formatDiag,
  summarizeAttempts,
  createHookSession
} = require('../shared/probe');

const WH_KEYBOARD_LL = 13;
const VERSION = require('../../package.json').version;

function nativeCandidates() {
  const rel = path.join('native', 'build', 'Release', 'hook_thread.node');
  const dev = path.join(__dirname, '..', '..', rel);
  const unpackedRoot = __dirname.replace(/app\.asar([\\/]|$)/, 'app.asar.unpacked$1');
  const unpacked = path.join(unpackedRoot, '..', '..', rel);
  return [unpacked, dev];
}

function loadNativeAddon() {
  const seen = Object.create(null);
  const errors = [];
  const files = nativeCandidates();
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (seen[file]) continue;
    seen[file] = true;
    if (!fs.existsSync(file)) {
      errors.push('missing ' + file);
      continue;
    }
    try {
      return { addon: require(file), error: '' };
    } catch (err) {
      errors.push((err && err.message) ? err.message : String(err));
    }
  }
  return { addon: null, error: errors.join(' | ') || 'missing' };
}

function wrapNative(addon) {
  return {
    kind: 'native-thread',
    nativeLoadError: '',
    setHandler(fn) { addon.setHandler(fn); },
    setLocked(locked) { addon.setLocked(!!locked); },
    isAlive() { return !!addon.isAlive(); },
    stats() { return addon.stats(); },
    start(kind) { return addon.start(kind); },
    probe() { return addon.probe(); },
    stop() { addon.stop(); }
  };
}

function createMissingBackend() {
  return {
    kind: 'missing',
    nativeLoadError: '',
    setHandler() {},
    setLocked() {},
    isAlive() { return false; },
    stats() { return null; },
    start() {
      return {
        ok: false,
        lastError: 0,
        hMod: 'none',
        code: 'unsupported-platform',
        detail: '宝宝锁的键盘钩子只支持 Windows。'
      };
    },
    probe() {
      return emptyProbe();
    },
    stop() {}
  };
}

function emptyProbe() {
  return {
    proven: false,
    probeSeen: false,
    procEntered: 0,
    procDelta: 0,
    lastVk: 0,
    lastFlags: 0,
    lastExtra: '0',
    sendInputCount: 0,
    injectMethod: '',
    yields: 0,
    pump: '',
    elapsedMs: 0
  };
}

function createPlatformBackend() {
  if (process.platform !== 'win32') return createMissingBackend();
  const loaded = loadNativeAddon();
  if (loaded.addon) return wrapNative(loaded.addon);
  const { createKoffiBackend } = require('./hook-koffi');
  const backend = createKoffiBackend();
  backend.nativeLoadError = loaded.error || 'missing';
  return backend;
}

function rowDetail(row) {
  if (!row) return describeWin32HookFailure(0);
  if (row.detail) return String(row.detail);
  if (row.code === 'unsupported-platform') return '宝宝锁的键盘钩子只支持 Windows。';
  return describeWin32HookFailure(row.lastError || 0);
}

function makeDiag(row, attempts, backend) {
  const last = row || {};
  return {
    version: VERSION,
    backend: backend && backend.kind ? backend.kind : '',
    hMod: last.hMod || '',
    pump: last.pump || (backend && backend.kind === 'native-thread' ? 'GetMessage' : ''),
    attempts: attempts.length,
    tried: summarizeAttempts(attempts),
    procEntered: last.procEntered || 0,
    probeSeen: !!last.probeSeen,
    proven: !!last.proven,
    lastVk: last.lastVk || 0,
    lastFlags: last.lastFlags || 0,
    lastExtra: last.lastExtra == null ? '0' : String(last.lastExtra),
    injectMethod: last.injectMethod || '',
    sendInputCount: last.sendInputCount || 0,
    yields: last.yields || 0,
    elapsedMs: last.elapsedMs || 0,
    nativeLoadError: backend && backend.nativeLoadError ? backend.nativeLoadError : ''
  };
}

function createWinHook(options) {
  const opts = options || {};
  const decide = opts.decide || function () { return { swallow: false }; };
  const onError = opts.onError || function () {};
  const onDiagnostic = opts.onDiagnostic || function () {};
  const onProven = opts.onProven || function () {};
  const onLockFromProof = opts.onLockFromProof || function () {};
  const backend = opts.backend || createPlatformBackend();
  const session = createHookSession();
  let installed = false;
  let lastDiag = null;

  function onKey(phase, vk) {
    const step = session.consumeKey(phase);
    if (step.proved) {
      try { onProven(); } catch (err) { onError(err); }
    }
    if (step.lockNow) {
      try { onLockFromProof(); } catch (err) { onError(err); }
      return true;
    }
    try {
      const decision = decide({
        phase: phase,
        vk: typeof vk === 'bigint' ? Number(vk) : Number(vk),
        now: Date.now()
      });
      return !!(decision && decision.swallow);
    } catch (err) {
      try { onError(err); } catch (ignore) { /* keep the hook alive */ }
      return !!(opts.isLocked && opts.isLocked());
    }
  }

  function note(diag) {
    lastDiag = diag;
    try { onDiagnostic(formatDiag(diag)); } catch (err) { /* logging must not break install */ }
  }

  async function install() {
    uninstall();
    try {
      backend.setHandler(onKey);
    } catch (err) {
      return {
        ok: false,
        code: 'hook-exception',
        detail: describeHookException(err)
      };
    }
    const attempts = [];
    try {
      for (let i = 0; i < HMOD_ORDER.length; i += 1) {
        const kind = HMOD_ORDER[i];
        const started = await Promise.resolve(backend.start(kind));
        const row = Object.assign({ hMod: kind, ok: false }, started || {});
        if (!row.ok) {
          attempts.push(row);
          await Promise.resolve(backend.stop());
          continue;
        }
        const probed = Object.assign(emptyProbe(), await Promise.resolve(backend.probe()));
        const full = Object.assign({}, row, probed, { hMod: row.hMod || kind });
        attempts.push(full);
        if (full.proven) {
          installed = true;
          session.markLive();
          const diag = makeDiag(full, attempts, backend);
          note(diag);
          return { ok: true, awaitingRealKey: false, diag: diag, diagLine: formatDiag(diag) };
        }
        await Promise.resolve(backend.stop());
      }

      let kept = null;
      for (let i = 0; i < HMOD_ORDER.length; i += 1) {
        const kind = HMOD_ORDER[i];
        const started = await Promise.resolve(backend.start(kind));
        const row = Object.assign({ hMod: kind, ok: false }, started || {});
        if (row.ok) {
          kept = row;
          break;
        }
        attempts.push(row);
        await Promise.resolve(backend.stop());
      }
      if (!kept) {
        const err = attempts[attempts.length - 1] || { ok: false, hMod: 'none' };
        const diag = makeDiag(err, attempts, backend);
        note(diag);
        installed = false;
        return {
          ok: false,
          code: err.code || 'set-hook-failed',
          detail: rowDetail(err) + '\n' + formatDiag(diag),
          diag: diag,
          diagLine: formatDiag(diag)
        };
      }
      installed = true;
      session.markAwaiting();
      const previous = attempts[attempts.length - 1] || {};
      const diag = makeDiag(Object.assign({}, previous, kept, {
        hMod: kept.hMod,
        proven: false
      }), attempts, backend);
      note(diag);
      return { ok: true, awaitingRealKey: true, diag: diag, diagLine: formatDiag(diag) };
    } catch (err) {
      try { await Promise.resolve(backend.stop()); } catch (ignore) { /* already down */ }
      installed = false;
      session.reset();
      return {
        ok: false,
        code: 'hook-exception',
        detail: describeHookException(err)
      };
    }
  }

  function uninstall() {
    installed = false;
    session.reset();
    try { backend.stop(); } catch (err) { /* already down */ }
  }

  function mergedDiag() {
    let live = null;
    try { live = backend.stats ? backend.stats() : null; } catch (err) { live = null; }
    if (!live) return lastDiag;
    return Object.assign({}, lastDiag || {}, {
      procEntered: live.procEntered,
      probeSeen: live.probeSeen,
      lastVk: live.lastVk,
      lastFlags: live.lastFlags,
      lastExtra: live.lastExtra,
      pump: live.pump || (lastDiag && lastDiag.pump) || ''
    });
  }

  function giveUp() {
    const diag = mergedDiag();
    uninstall();
    return {
      ok: false,
      code: 'probe-not-sync',
      detail: PROBE_NOT_SYNC_DETAIL + (diag ? '\n' + formatDiag(diag) : ''),
      diag: diag,
      diagLine: diag ? formatDiag(diag) : ''
    };
  }

  return {
    install: install,
    uninstall: uninstall,
    giveUp: giveUp,
    armLock() { return session.armLock(); },
    isActive() { return installed && session.isLive(); },
    isAwaitingProof() { return installed && session.isAwaiting(); },
    isInstalled() { return installed; },
    isAlive() { return installed && backend.isAlive(); },
    setLocked(locked) {
      try { backend.setLocked(!!locked); } catch (err) { /* best effort */ }
    }
  };
}

module.exports = {
  createWinHook,
  loadNativeAddon,
  WH_KEYBOARD_LL,
  HMOD_ORDER,
  get KBDLLHOOKSTRUCT() {
    return require('./hook-koffi').KBDLLHOOKSTRUCT;
  }
};
