'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  PROBE_EXTRA,
  PROBE_VK,
  KEYEVENTF_KEYUP,
  LLKHF_INJECTED,
  PROBE_NOT_SYNC_DETAIL,
  isProbeEvent,
  runInstalledProbe
} = require('../src/shared/probe');
const { pumpUntil, PM_NOREMOVE, QS_ALLINPUT, PROBE_PUMP_MS } = require('../src/main/message-pump');

test('probe succeeds only when the hook runs while this thread pumps', function () {
  const state = { hHook: 1, probeSeen: false };
  const order = [];
  const result = runInstalledProbe(state, {
    inject(vk, scan, flags, extra) {
      order.push('inject:' + flags);
      assert.equal(vk, PROBE_VK);
      assert.equal(scan, 0);
      assert.equal(extra, PROBE_EXTRA);
      assert.equal(state.probeSeen, false);
    },
    pump(pred) {
      const before = !!pred();
      order.push('pump-before:' + before);
      if (!before && order.filter(function (item) { return item.startsWith('pump-before'); }).length === 1) {
        state.probeSeen = true;
      }
      order.push('pump-after:' + !!pred());
      return pred();
    }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(order, [
    'inject:0',
    'pump-before:false',
    'pump-after:true',
    'inject:' + KEYEVENTF_KEYUP,
    'pump-before:false',
    'pump-after:false'
  ]);
});

test('a same-thread inject that sets the flag before the pump still counts', function () {
  const state = { hHook: 1, probeSeen: false };
  let pumps = 0;
  const result = runInstalledProbe(state, {
    inject(_vk, _scan, flags) {
      if (flags === 0) state.probeSeen = true;
    },
    pump(pred) {
      pumps += 1;
      return pred();
    }
  });
  assert.equal(result.ok, true);
  assert.equal(pumps, 2);
});

test('probe stays honest when pumping never delivers the test key', function () {
  const state = { hHook: 1, probeSeen: false };
  let injects = 0;
  const result = runInstalledProbe(state, {
    inject() { injects += 1; },
    pump() { return false; }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'probe-not-sync');
  assert.equal(result.detail, PROBE_NOT_SYNC_DETAIL);
  assert.equal(result.detail, '钩子没有在按键到达其他程序之前同步拦住测试按键，因此不能用来上锁。');
  assert.equal(injects, 2);
});

test('missing hook does not inject a probe key', function () {
  let injects = 0;
  const result = runInstalledProbe({ hHook: null, probeSeen: false }, {
    inject() { injects += 1; },
    pump() { throw new Error('should not pump'); }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'probe-no-hook');
  assert.match(result.detail, /钩子句柄无效/);
  assert.equal(injects, 0);
});

test('probe event is the magic extra, or an injected F23 only while probing', function () {
  assert.equal(isProbeEvent({ dwExtraInfo: PROBE_EXTRA, vkCode: 0x41, flags: 0 }, false), true);
  assert.equal(isProbeEvent({ dwExtraInfo: BigInt(PROBE_EXTRA), vkCode: 1, flags: 0 }, false), true);
  assert.equal(isProbeEvent({
    dwExtraInfo: 0,
    vkCode: PROBE_VK,
    flags: LLKHF_INJECTED
  }, true), true);
  assert.equal(isProbeEvent({
    dwExtraInfo: 0,
    vkCode: PROBE_VK,
    flags: LLKHF_INJECTED | 0x80
  }, true), true);
  assert.equal(isProbeEvent({
    dwExtraInfo: 0,
    vkCode: PROBE_VK,
    flags: LLKHF_INJECTED
  }, false), false);
  assert.equal(isProbeEvent({ dwExtraInfo: 0, vkCode: PROBE_VK, flags: 0 }, true), false);
  assert.equal(isProbeEvent({ dwExtraInfo: 0, vkCode: 0x41, flags: LLKHF_INJECTED }, true), false);
  assert.equal(isProbeEvent(null, true), false);
});

test('pump enters the kernel before giving up, and stops once the hook is seen', function () {
  let seen = false;
  let waits = 0;
  const immediate = pumpUntil(function () { return seen; }, 400, {
    peek() { seen = true; },
    wait() { waits += 1; },
    sleep() { throw new Error('sleep after the hook was seen'); }
  }, function () { return 0; });
  assert.equal(immediate, true);
  assert.equal(waits, 0);

  let t = 0;
  const calls = [];
  const timedOut = pumpUntil(function () { return false; }, 40, {
    peek() { calls.push('peek'); },
    wait(ms) {
      calls.push('wait:' + ms);
      t += ms;
    },
    sleep() { throw new Error('wait advanced the clock'); }
  }, function () { return t; });
  assert.equal(timedOut, false);
  assert.equal(calls[0], 'peek');
  assert.ok(calls.some(function (item) { return item.startsWith('wait:'); }));
  assert.ok(t >= 40);

  let spun = 0;
  let sleeps = 0;
  pumpUntil(function () { return false; }, 12, {
    peek() {},
    wait() { spun += 1; },
    sleep(ms) { sleeps += 1; spun += ms; }
  }, function () { return spun > 12 ? 12 : 0; });
  assert.ok(sleeps >= 1);
});

test('windows probe path pumps and does not sample the flag after a sync keybd_event', function () {
  const src = fs.readFileSync(path.join(__dirname, '../src/main/hook-win.js'), 'utf8');
  assert.match(src, /runInstalledProbe/);
  assert.match(src, /isProbeEvent/);
  assert.match(src, /keybd_event\.async\(/);
  assert.match(src, /PeekMessageW/);
  assert.match(src, /MsgWaitForMultipleObjects/);
  assert.match(src, /PM_NOREMOVE/);
  assert.equal(PM_NOREMOVE, 0);
  assert.equal(QS_ALLINPUT & 0x40, 0x40);
  const withoutSignature = src.replace(/__stdcall keybd_event\([^)]*\)/g, '');
  assert.equal(/keybd_event\s*\(/.test(withoutSignature), false);
  // Win10+ caps LowLevelHooksTimeout at 1000ms. A shorter pump can Unhook
  // the callback while the worker is still blocked inside keybd_event.
  assert.ok(PROBE_PUMP_MS >= 1000);
});

test('probe before install does not claim the keyboard is locked', function () {
  const { createWinHook } = require('../src/main/hook-win');
  const hook = createWinHook({
    decide() { return { swallow: true }; }
  });
  const result = hook.probe();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'probe-no-hook');
  assert.match(result.detail, /钩子句柄无效/);
  assert.equal(hook.isActive(), false);
});
