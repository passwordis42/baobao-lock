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
  LLKHF_LOWER_IL_INJECTED,
  INPUT_SIZE,
  HMOD_ORDER,
  PROBE_NOT_SYNC_DETAIL,
  isProbeEvent,
  writeKeyboardInputs,
  summarizeAttempts,
  formatDiag,
  runYieldProbe
} = require('../src/shared/probe');
const { trayStatus } = require('../src/shared/messages');
const { createWinHook } = require('../src/main/hook-win');

function emptyProbe(over) {
  return Object.assign({
    proven: false,
    probeSeen: false,
    procEntered: 0,
    procDelta: 0,
    lastVk: 0,
    lastFlags: 0,
    lastExtra: '0',
    sendInputCount: 0,
    injectMethod: 'SendInput',
    yields: 0,
    pump: 'GetMessage',
    elapsedMs: 4
  }, over || {});
}

function scriptedBackend(ctrl) {
  let handler = null;
  return {
    kind: 'fake',
    nativeLoadError: ctrl.nativeLoadError || '',
    setHandler(fn) { handler = fn; },
    setLocked(locked) { ctrl.locked = !!locked; },
    isAlive() { return ctrl.alive !== false; },
    stats() {
      return ctrl.stats || {
        procEntered: 0,
        probeSeen: false,
        lastVk: 0,
        lastFlags: 0,
        lastExtra: '0',
        pump: 'GetMessage'
      };
    },
    start(kind) {
      ctrl.events.push('start:' + kind);
      const result = ctrl.onStart ? ctrl.onStart(kind) : { ok: true, lastError: 0, hMod: kind };
      return Object.assign({ hMod: kind }, result);
    },
    probe() {
      ctrl.events.push('probe');
      return ctrl.onProbe ? ctrl.onProbe() : emptyProbe({ proven: true, probeSeen: true, procEntered: 1, procDelta: 1 });
    },
    stop() { ctrl.events.push('stop'); },
    emit(phase, vk) { return handler(phase, vk); }
  };
}

test('probe event is the magic extra, or the probe vk while a probe is in flight', function () {
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
    flags: LLKHF_LOWER_IL_INJECTED
  }, true), true);
  assert.equal(isProbeEvent({ dwExtraInfo: 0, vkCode: PROBE_VK, flags: 0 }, true), true);
  assert.equal(isProbeEvent({
    dwExtraInfo: 0,
    vkCode: PROBE_VK,
    flags: LLKHF_INJECTED
  }, false), false);
  assert.equal(isProbeEvent({ dwExtraInfo: 0, vkCode: 0x41, flags: LLKHF_INJECTED }, true), false);
  assert.equal(isProbeEvent(null, true), false);
  assert.equal(PROBE_VK, 0xE8);
});

test('keyboard input buffer matches the x64 INPUT layout', function () {
  const buf = writeKeyboardInputs(PROBE_VK, PROBE_EXTRA);
  assert.equal(buf.length, INPUT_SIZE * 2);
  assert.equal(buf.readUInt32LE(0), 1);
  assert.equal(buf.readUInt16LE(8), PROBE_VK);
  assert.equal(buf.readUInt32LE(12), 0);
  assert.equal(buf.readBigUInt64LE(24), BigInt(PROBE_EXTRA));
  assert.equal(buf.readUInt16LE(INPUT_SIZE + 8), PROBE_VK);
  assert.equal(buf.readUInt32LE(INPUT_SIZE + 12), KEYEVENTF_KEYUP);
  assert.equal(buf.readBigUInt64LE(INPUT_SIZE + 24), BigInt(PROBE_EXTRA));
});

test('yield probe waits for the event loop before accepting a miss', async function () {
  let waits = 0;
  const state = { probeSeen: false, procEntered: 0, procAtStart: 0 };
  let started = false;
  const result = await runYieldProbe(state, {
    timeout: 1000,
    now() { return waits * 10; },
    inject() {
      started = true;
      return { injectMethod: 'SendInput', sendInputCount: 2 };
    },
    async wait() {
      waits += 1;
      if (waits === 2) {
        state.probeSeen = true;
        state.procEntered = 1;
      }
    }
  });
  assert.equal(started, true);
  assert.equal(result.ok, true);
  assert.ok(result.yields >= 2);
  assert.equal(result.inject.injectMethod, 'SendInput');
});

test('yield probe stays honest when the callback never runs', async function () {
  let now = 0;
  const result = await runYieldProbe({ probeSeen: false, procEntered: 0, procAtStart: 0 }, {
    timeout: 30,
    now() { return now; },
    inject() { return { injectMethod: 'SendInput', sendInputCount: 0 }; },
    async wait(ms) { now += ms || 1; }
  });
  assert.equal(result.ok, false);
  assert.ok(result.yields >= 1);
});

test('native-style probe success marks the hook live without a real key', async function () {
  const ctrl = { events: [] };
  const backend = scriptedBackend(ctrl);
  const hook = createWinHook({
    backend: backend,
    decide() { return { swallow: true }; }
  });
  const result = await hook.install();
  assert.equal(result.ok, true);
  assert.equal(result.awaitingRealKey, false);
  assert.equal(hook.isActive(), true);
  assert.equal(hook.isAwaitingProof(), false);
  assert.deepEqual(ctrl.events, ['stop', 'start:addon', 'probe']);
  assert.match(result.diagLine, /backend=fake/);
  assert.match(result.diagLine, /procEntered=1/);
  assert.match(result.diagLine, /probeSeen=1/);
  assert.equal(summarizeAttempts([{ hMod: 'addon', ok: true, proven: true }]), 'addon:proven');
});

test('hMod attempts continue until the procedure actually runs', async function () {
  const ctrl = {
    events: [],
    onProbe() {
      const starts = ctrl.events.filter(function (item) { return item.indexOf('start:') === 0; });
      const kind = starts[starts.length - 1];
      if (kind === 'start:addon') return emptyProbe();
      return emptyProbe({
        proven: true,
        probeSeen: false,
        procEntered: 2,
        procDelta: 2,
        lastVk: PROBE_VK,
        lastFlags: LLKHF_INJECTED,
        lastExtra: '0'
      });
    }
  };
  const backend = scriptedBackend(ctrl);
  const hook = createWinHook({ backend: backend, decide() { return { swallow: false }; } });
  const result = await hook.install();
  assert.equal(result.ok, true);
  assert.equal(hook.isActive(), true);
  assert.deepEqual(ctrl.events, ['stop', 'start:addon', 'probe', 'stop', 'start:null', 'probe']);
  assert.match(result.diagLine, /tried=addon:no-proc,null:proven/);
  assert.match(result.diag.tried, /null:proven/);
  assert.equal(HMOD_ORDER[0], 'addon');
  assert.equal(HMOD_ORDER[1], 'null');
});

test('synthetic miss keeps the hook and a real key proves it before lock', async function () {
  const ctrl = { events: [], onProbe() { return emptyProbe(); } };
  const backend = scriptedBackend(ctrl);
  let proved = 0;
  let locks = 0;
  let decisions = 0;
  const hook = createWinHook({
    backend: backend,
    decide() {
      decisions += 1;
      return { swallow: false };
    },
    onProven() { proved += 1; },
    onLockFromProof() { locks += 1; }
  });
  const result = await hook.install();
  assert.equal(result.ok, true);
  assert.equal(result.awaitingRealKey, true);
  assert.equal(hook.isActive(), false);
  assert.equal(hook.isAwaitingProof(), true);
  assert.equal(hook.isInstalled(), true);
  const passed = backend.emit('down', 0x41);
  assert.equal(passed, false);
  assert.equal(proved, 1);
  assert.equal(locks, 0);
  assert.equal(decisions, 1);
  assert.equal(hook.isActive(), true);
  assert.equal(hook.isAwaitingProof(), false);
  assert.equal(trayStatus({ hookActive: false, hookAwaiting: true, locked: false }).text, '请按任意键确认');
  assert.equal(trayStatus({ hookActive: true, locked: true }).text, '已上锁');
});

test('armed lock swallows the first real key and does not pretend before that', async function () {
  const ctrl = { events: [], onProbe() { return emptyProbe(); } };
  const backend = scriptedBackend(ctrl);
  let locks = 0;
  let decisions = 0;
  const hook = createWinHook({
    backend: backend,
    decide() {
      decisions += 1;
      return { swallow: false };
    },
    onLockFromProof() { locks += 1; }
  });
  await hook.install();
  assert.equal(hook.armLock(), 'wait');
  const swallowed = backend.emit('down', 0x42);
  assert.equal(swallowed, true);
  assert.equal(locks, 1);
  assert.equal(decisions, 0);
  assert.equal(hook.isActive(), true);
  backend.emit('down', 0x43);
  assert.equal(decisions, 1);
});

test('give up after a missed probe and no real key is an honest failure', async function () {
  const ctrl = {
    events: [],
    onProbe() { return emptyProbe({ lastFlags: 0, lastExtra: '0x0' }); },
    stats: { procEntered: 0, probeSeen: false, lastVk: 0, lastFlags: 0, lastExtra: '0x0', pump: 'GetMessage' }
  };
  const backend = scriptedBackend(ctrl);
  const hook = createWinHook({ backend: backend, decide() { return { swallow: false }; } });
  await hook.install();
  const failed = hook.giveUp();
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'probe-not-sync');
  assert.equal(PROBE_NOT_SYNC_DETAIL, '钩子没有在按键到达其他程序之前同步拦住测试按键，真实按键也没有进入回调，因此不能用来上锁。');
  assert.match(failed.detail, /真实按键也没有进入回调/);
  assert.match(failed.detail, /procEntered=0/);
  assert.match(failed.detail, /lastFlags=0x0/);
  assert.match(formatDiag(failed.diag), /v=1\.0\.0/);
  assert.equal(hook.isActive(), false);
  assert.equal(hook.isInstalled(), false);
  assert.equal(hook.isAwaitingProof(), false);
});

test('SetWindowsHookEx failure does not report the keyboard locked', async function () {
  const ctrl = {
    events: [],
    onStart() { return { ok: false, lastError: 5, hMod: 'addon' }; }
  };
  const backend = scriptedBackend(ctrl);
  const hook = createWinHook({ backend: backend, decide() { return { swallow: true }; } });
  const result = await hook.install();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'set-hook-failed');
  assert.match(result.detail, /系统错误码 5/);
  assert.equal(hook.isActive(), false);
  assert.equal(hook.isInstalled(), false);
});

test('v0.1.3 hook path is a real GetMessage thread, not the koffi pump', function () {
  const root = path.join(__dirname, '..');
  const win = fs.readFileSync(path.join(root, 'src/main/hook-win.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'src/main/index.js'), 'utf8');
  const native = fs.readFileSync(path.join(root, 'native/hook_thread.c'), 'utf8');
  const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  assert.equal(fs.existsSync(path.join(root, 'src/main/message-pump.js')), false);
  assert.equal(/keybd_event\.async/.test(win), false);
  assert.equal(/PeekMessageW/.test(win), false);
  assert.equal(/hook\.probe\(/.test(index), false);
  assert.match(index, /awaitingRealKey/);
  assert.match(index, /还没锁住/);
  assert.match(index, /canPresentLocked/);
  assert.match(native, /GetMessageW/);
  assert.match(native, /DispatchMessageW/);
  assert.match(native, /SendInput/);
  assert.match(native, /SetWindowsHookExW\(WH_KEYBOARD_LL/);
  assert.equal(native.includes('WH_MOUSE'), false);
  assert.match(pkg, /hook_thread\.node/);
  assert.match(pkg, /"version": "1\.0\.0"/);
  assert.match(pkg, /asInvoker/);
  assert.deepEqual(HMOD_ORDER, ['addon', 'null', 'exe']);
});
