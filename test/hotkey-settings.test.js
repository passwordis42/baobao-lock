'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { formatSpaced, formatCompact, formatHold } = require('../src/shared/format');
const { validateHotkey, validateHoldKey } = require('../src/shared/hotkey');
const {
  defaultSettings,
  sanitizeSettings,
  validateSettingsDraft,
  createSettingsStore
} = require('../src/shared/settings-store');
const { defaultWidgetPosition, resolveWidgetPosition } = require('../src/shared/position');
const { hookFailureMessage, trayStatus, trayTooltip } = require('../src/shared/messages');
const { isProbeExtra, PROBE_EXTRA } = require('../src/shared/probe');

test('formats hotkeys and the emergency counter like the mocks', function () {
  const lock = defaultSettings().lockHotkey;
  const unlock = defaultSettings().unlockHotkey;
  assert.equal(formatSpaced(lock), 'Ctrl + Alt + K');
  assert.equal(formatCompact(unlock), 'Ctrl+Alt+L');
  assert.equal(formatSpaced(defaultSettings().holdLockKey), '-');
  assert.equal(formatSpaced({ key: 'SUBTRACT' }), 'Num-');
  assert.equal(formatHold(1800), '1.8 / 3 秒');
  assert.equal(formatHold(0), '0.0 / 3 秒');
  assert.equal(formatHold(3000), '3.0 / 3 秒');
});

test('rejects unsafe or incomplete hotkeys', function () {
  assert.equal(validateHotkey({ key: 'K' }).ok, false);
  assert.equal(validateHotkey({ ctrl: true, alt: true, key: 'ESCAPE' }).ok, false);
  assert.equal(validateHotkey({ win: true, key: 'L' }).ok, false);
  assert.equal(validateHotkey({ ctrl: true, alt: true, key: 'DELETE' }).ok, false);
  assert.equal(validateHotkey({ ctrl: true, shift: true, key: 'F8' }).ok, true);
  assert.equal(validateHoldKey({ key: 'OEM_MINUS' }).ok, true);
  assert.equal(validateHoldKey({ key: 'ESCAPE' }).ok, false);
  assert.equal(validateHoldKey({ ctrl: true, key: 'K' }).ok, false);
  assert.equal(validateHoldKey({ key: 'SUBTRACT' }).hotkey.key, 'SUBTRACT');
  const hold = validateSettingsDraft({
    lockHotkey: { ctrl: true, alt: true, key: 'K' },
    unlockHotkey: { ctrl: true, alt: true, key: 'L' },
    holdLockKey: { key: 'F8' },
    tipSound: true,
    alwaysOnTop: true
  });
  assert.equal(hold.ok, true);
  assert.equal(hold.settings.holdLockKey.key, 'F8');
  const same = validateSettingsDraft({
    lockHotkey: { ctrl: true, alt: true, key: 'K' },
    unlockHotkey: { ctrl: true, alt: true, key: 'K' },
    tipSound: true,
    alwaysOnTop: true
  });
  assert.equal(same.ok, false);
});

test('settings file cannot restore a lock or login auto-start', function () {
  const clean = sanitizeSettings({
    locked: true,
    openAtLogin: true,
    autoLock: true,
    tipSound: false,
    alwaysOnTop: false,
    lockHotkey: { ctrl: true, alt: true, key: 'K' },
    unlockHotkey: { ctrl: true, alt: true, key: 'L' },
    widgetPosition: { x: 10, y: 20 }
  });
  assert.equal(clean.tipSound, false);
  assert.equal(clean.alwaysOnTop, false);
  assert.deepEqual(clean.widgetPosition, { x: 10, y: 20 });
  assert.equal(clean.holdLockKey.key, 'OEM_MINUS');
  assert.equal(clean.locked, undefined);
  assert.equal(clean.openAtLogin, undefined);
  assert.equal(JSON.stringify(clean).includes('openAtLogin'), false);
});

test('store round-trips and recovers a broken file', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baobao-'));
  const file = path.join(dir, 'settings.json');
  const store = createSettingsStore(file);
  store.merge({
    tipSound: false,
    lockHotkey: { ctrl: true, shift: true, alt: false, win: false, key: 'J' }
  });
  const again = createSettingsStore(file);
  assert.equal(again.get().tipSound, false);
  assert.equal(again.get().lockHotkey.key, 'J');
  assert.equal(again.get().unlockHotkey.key, 'L');
  fs.writeFileSync(file, '{not json');
  const recovered = createSettingsStore(file);
  assert.equal(recovered.get().lockHotkey.key, 'K');
  assert.equal(fs.existsSync(file + '.bad'), true);
});

test('widget position defaults to the primary work area bottom-right and sticks across monitors', function () {
  const size = { width: 210, height: 250 };
  const primary = { x: 0, y: 0, width: 1920, height: 1040 };
  const pos = defaultWidgetPosition(primary, size, 24);
  assert.equal(pos.x, 1920 - 210 - 24);
  assert.equal(pos.y, 1040 - 250 - 24);
  const displays = [
    { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }
  ];
  const saved = { x: 2100, y: 400 };
  assert.deepEqual(resolveWidgetPosition(saved, displays, primary, size), saved);
  const lost = resolveWidgetPosition({ x: 9000, y: 9000 }, displays, primary, size);
  assert.deepEqual(lost, pos);
});

test('hook failure copy says the keyboard is not locked', function () {
  const copy = hookFailureMessage({ detail: 'SetWindowsHookExW 失败（错误码 5）。' });
  assert.equal(copy.title, '键盘钩子未生效');
  assert.match(copy.message, /没有锁住/);
  assert.match(copy.detail, /不会假装已经锁住键盘/);
  assert.match(copy.detail, /以管理员身份运行/);
  assert.match(copy.detail, /错误码 5/);
  assert.equal(trayStatus({ hookActive: false, locked: true }).text, '钩子未生效');
  assert.equal(trayStatus({ hookActive: true, locked: true }).kind, 'locked');
  assert.equal(trayStatus({ hookActive: true, locked: false }).text, '未上锁');
  assert.equal(trayTooltip({ hookActive: false }), '宝宝锁 · 钩子未生效');
});

test('probe marker matches only the magic extra info', function () {
  assert.equal(isProbeExtra(PROBE_EXTRA), true);
  assert.equal(isProbeExtra(BigInt(PROBE_EXTRA)), true);
  assert.equal(isProbeExtra(0), false);
  assert.equal(isProbeExtra(null), false);
});
