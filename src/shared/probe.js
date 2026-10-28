'use strict';

/** Magic dwExtraInfo for the install-time swallow probe. Not a user key. */
const PROBE_EXTRA = 0x4242424b;
/** F23. Typical hardware has no such key, so the probe does not type into a document. */
const PROBE_VK = 0x86;
const KEYEVENTF_KEYUP = 0x0002;
/** Set by Windows on keybd_event / SendInput, not on a physical key. */
const LLKHF_INJECTED = 0x10;

const PROBE_NOT_SYNC_DETAIL =
  '钩子没有在按键到达其他程序之前同步拦住测试按键，因此不能用来上锁。';

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
 * dwExtraInfo is the primary mark. While a probe is in flight, an injected
 * F23 also counts, in case the extra value does not round-trip through koffi.
 * A physical F23 (no LLKHF_INJECTED) is left for the normal lock policy.
 */
function isProbeEvent(kb, probing) {
  if (!kb || typeof kb !== 'object') return false;
  if (isProbeExtra(kb.dwExtraInfo)) return true;
  if (!probing) return false;
  if (asNumber(kb.vkCode) !== PROBE_VK) return false;
  return (asNumber(kb.flags) & LLKHF_INJECTED) !== 0;
}

/**
 * Inject a probe key on another thread, then pump THIS thread until the hook
 * has seen it. `io.inject` must not block the installing thread: the low-level
 * hook runs only while that thread is pumping, and a same-thread keybd_event
 * returns before the callback, which is the v0.1.1 false `probe-not-sync`.
 * The key-up is injected even when the down was missed, so F23 is not left down.
 */
function runInstalledProbe(state, io) {
  if (!state || !state.hHook) {
    return { ok: false, code: 'probe-no-hook', detail: '钩子句柄无效。' };
  }
  state.probeSeen = false;
  io.inject(PROBE_VK, 0, 0, PROBE_EXTRA);
  const sawDown = !!io.pump(function () { return !!state.probeSeen; });
  state.probeSeen = false;
  io.inject(PROBE_VK, 0, KEYEVENTF_KEYUP, PROBE_EXTRA);
  io.pump(function () { return !!state.probeSeen; });
  if (!sawDown) {
    return { ok: false, code: 'probe-not-sync', detail: PROBE_NOT_SYNC_DETAIL };
  }
  return { ok: true };
}

module.exports = {
  PROBE_EXTRA,
  PROBE_VK,
  KEYEVENTF_KEYUP,
  LLKHF_INJECTED,
  PROBE_NOT_SYNC_DETAIL,
  isProbeExtra,
  isProbeEvent,
  runInstalledProbe
};
