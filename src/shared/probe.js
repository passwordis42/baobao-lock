'use strict';

/** Magic dwExtraInfo for the install-time swallow probe. Not a user key. */
const PROBE_EXTRA = 0x4242424b;
/**
 * Unassigned VK. F23 (0x86) can still be a real key on some keyboards; 0xE8
 * is not a typing key, so a missed swallow does not insert a character.
 */
const PROBE_VK = 0xE8;
const KEYEVENTF_KEYUP = 0x0002;
const LLKHF_LOWER_IL_INJECTED = 0x02;
const LLKHF_INJECTED = 0x10;
const INPUT_KEYBOARD = 1;
/** sizeof(INPUT) on Windows x64. The native addon checks this with sizeof. */
const INPUT_SIZE = 40;
const HMOD_ORDER = ['addon', 'null', 'exe'];

const PROBE_NOT_SYNC_DETAIL =
  '钩子没有在按键到达其他程序之前同步拦住测试按键，真实按键也没有进入回调，因此不能用来上锁。';

function isProbeExtra(extra) {
  if (extra == null || extra === false) return false;
  try {
    return BigInt(extra) === BigInt(PROBE_EXTRA);
  } catch (err) {
    return extra === PROBE_EXTRA;
  }
}

function asNumber(value) {
  if (typeof value === 'bigint') return Number(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * True when this hook event is our install probe and must be swallowed.
 * dwExtraInfo is the primary mark. While a probe is in flight, the probe VK
 * also counts: koffi or Windows may drop dwExtraInfo, and an injected key may
 * carry LLKHF_INJECTED, LLKHF_LOWER_IL_INJECTED, or neither.
 */
function isProbeEvent(kb, probing) {
  if (!kb || typeof kb !== 'object') return false;
  if (isProbeExtra(kb.dwExtraInfo)) return true;
  if (!probing) return false;
  if (asNumber(kb.vkCode) !== PROBE_VK) return false;
  const flags = asNumber(kb.flags);
  if ((flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) !== 0) return true;
  return true;
}

/**
 * x64 INPUT[2]: down then up. Layout matches the Win32 SDK (type, pad, KEYBDINPUT
 * with dwExtraInfo at offset 24). The native hook uses the real struct.
 */
function writeKeyboardInputs(vk, extra) {
  const buf = Buffer.alloc(INPUT_SIZE * 2);
  writeOne(buf, 0, vk, 0, extra);
  writeOne(buf, INPUT_SIZE, vk, KEYEVENTF_KEYUP, extra);
  return buf;
}

function writeOne(buf, offset, vk, flags, extra) {
  buf.writeUInt32LE(INPUT_KEYBOARD, offset);
  buf.writeUInt16LE(vk & 0xffff, offset + 8);
  buf.writeUInt16LE(0, offset + 10);
  buf.writeUInt32LE(flags >>> 0, offset + 12);
  buf.writeUInt32LE(0, offset + 16);
  buf.writeBigUInt64LE(BigInt(extra), offset + 24);
}

function summarizeAttempts(attempts) {
  return (attempts || []).map(function (row) {
    const name = row && row.hMod ? row.hMod : '?';
    if (!row || row.ok === false) return name + ':set-fail';
    if (row.proven) return name + ':proven';
    return name + ':no-proc';
  }).join(',');
}

function formatDiag(diag) {
  const d = diag || {};
  const flags = asNumber(d.lastFlags);
  return [
    'v=' + (d.version || ''),
    'backend=' + (d.backend || ''),
    'hMod=' + (d.hMod || ''),
    'pump=' + (d.pump || ''),
    'attempts=' + (d.attempts == null ? 0 : d.attempts),
    'tried=' + (d.tried || ''),
    'procEntered=' + (d.procEntered == null ? 0 : d.procEntered),
    'probeSeen=' + (d.probeSeen ? 1 : 0),
    'proven=' + (d.proven ? 1 : 0),
    'lastVk=' + (d.lastVk == null ? 0 : d.lastVk),
    'lastFlags=0x' + (flags >>> 0).toString(16),
    'lastExtra=' + (d.lastExtra == null ? '0' : String(d.lastExtra)),
    'inject=' + (d.injectMethod || ''),
    'sendInput=' + (d.sendInputCount == null ? 0 : d.sendInputCount),
    'yields=' + (d.yields == null ? 0 : d.yields),
    'elapsedMs=' + (d.elapsedMs == null ? 0 : d.elapsedMs),
    'nativeLoad=' + (d.nativeLoadError || '')
  ].join(' ');
}

/**
 * Start the injector, then yield so the installing thread's real message loop
 * (Electron's, not a koffi PeekMessage) can run the hook. `io.inject` must
 * return a promise and must not block this thread: a same-thread SendInput
 * deadlocks the low-level hook, which is the v0.1.1 failure. v0.1.2 pumped
 * inside koffi and the callback never reached JS.
 */
async function runYieldProbe(state, io) {
  const timeout = io.timeout == null ? 1200 : io.timeout;
  const now = io.now || Date.now;
  const started = now();
  const startedEntered = Number(state.procAtStart || 0);
  let injectPromise;
  try {
    injectPromise = Promise.resolve(io.inject());
  } catch (err) {
    injectPromise = Promise.resolve({
      injectMethod: 'error',
      sendInputCount: 0,
      error: err && err.message ? err.message : String(err)
    });
  }
  let yields = 0;
  while (!state.probeSeen && yields < 500 && (now() - started) < timeout) {
    yields += 1;
    await io.wait(Math.min(15, Math.max(0, timeout - (now() - started))));
  }
  if (!state.probeSeen && yields < 500) {
    yields += 1;
    await io.wait(0);
  }
  let inject;
  try {
    inject = await injectPromise;
  } catch (err) {
    inject = {
      injectMethod: 'error',
      sendInputCount: 0,
      error: err && err.message ? err.message : String(err)
    };
  }
  const entered = Number(state.procEntered || 0) > startedEntered;
  return {
    ok: !!state.probeSeen || entered,
    yields: yields,
    elapsedMs: now() - started,
    inject: inject || {}
  };
}

function createHookSession() {
  let mode = 'off';
  let pendingLock = false;

  return {
    reset() {
      mode = 'off';
      pendingLock = false;
    },
    markLive() {
      mode = 'live';
      pendingLock = false;
    },
    markAwaiting() {
      mode = 'awaiting';
    },
    isLive() {
      return mode === 'live';
    },
    isAwaiting() {
      return mode === 'awaiting';
    },
    armLock() {
      if (mode === 'live') return 'immediate';
      if (mode === 'awaiting') {
        pendingLock = true;
        return 'wait';
      }
      return 'absent';
    },
    consumeKey(phase) {
      const proved = mode === 'awaiting';
      if (proved) mode = 'live';
      const lockNow = pendingLock && phase === 'down';
      if (lockNow) pendingLock = false;
      return { proved: proved, lockNow: lockNow };
    }
  };
}

module.exports = {
  PROBE_EXTRA,
  PROBE_VK,
  KEYEVENTF_KEYUP,
  LLKHF_INJECTED,
  LLKHF_LOWER_IL_INJECTED,
  INPUT_KEYBOARD,
  INPUT_SIZE,
  HMOD_ORDER,
  PROBE_NOT_SYNC_DETAIL,
  isProbeExtra,
  isProbeEvent,
  writeKeyboardInputs,
  summarizeAttempts,
  formatDiag,
  runYieldProbe,
  createHookSession
};
