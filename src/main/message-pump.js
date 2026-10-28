'use strict';

/**
 * WH_KEYBOARD_LL is delivered on the installing thread only while that thread
 * is inside PeekMessage / GetMessage / MsgWaitForMultipleObjects. PeekMessage
 * dispatches sent messages even with PM_NOREMOVE, which is how the hook
 * procedure runs. Posted messages are left in the queue for Electron.
 *
 * A tight PeekMessage loop would spin when the queue is already non-empty,
 * because MsgWait returns immediately in that case. Sleep a few milliseconds
 * then, so the UI thread stays usable while still entering the kernel often
 * enough for the hook timeout not to fire.
 *
 * If the hook never runs, keybd_event stays blocked until Windows gives up
 * (LowLevelHooksTimeout, at most 1000ms on Windows 10 1709+). Unhooking
 * before that returns can free the callback while the worker is still
 * inside the call. The budget is therefore longer than that cap; a working
 * hook still returns as soon as the test key is seen.
 */

const PM_NOREMOVE = 0x0000;
/** QS_ALLINPUT from the Windows 10 SDK (includes QS_SENDMESSAGE). */
const QS_ALLINPUT = 0x1CFF;
const PROBE_PUMP_MS = 1500;
const MAX_PUMP_ITERS = 10000;

function pumpUntil(shouldStop, timeoutMs, api, now) {
  const clock = now || Date.now;
  const deadline = clock() + timeoutMs;
  for (let i = 0; i < MAX_PUMP_ITERS && !shouldStop(); i += 1) {
    api.peek();
    if (shouldStop()) return true;
    const remaining = deadline - clock();
    if (remaining <= 0) break;
    const started = clock();
    api.wait(Math.min(15, remaining));
    if (shouldStop()) return true;
    if (clock() - started < 2) api.sleep(5);
  }
  return !!shouldStop();
}

module.exports = {
  pumpUntil,
  PM_NOREMOVE,
  QS_ALLINPUT,
  PROBE_PUMP_MS
};
