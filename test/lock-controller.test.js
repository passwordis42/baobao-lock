'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VK } = require('../src/shared/keys');
const { createLockController, EMERGENCY_MS } = require('../src/shared/lock-controller');
const { canPresentLocked } = require('../src/shared/messages');

function down(controller, name, now) {
  return controller.event({ phase: 'down', vk: VK[name], now: now || 0 });
}

function up(controller, name) {
  return controller.event({ phase: 'up', vk: VK[name], now: 0 });
}

function pressChord(controller, modifiers, key, now) {
  modifiers.forEach(function (name) { down(controller, name, now || 0); });
  return down(controller, key, now || 0);
}

function release(controller, names) {
  names.forEach(function (name) { up(controller, name); });
}

test('boots unlocked and ignores a persisted lock flag', function () {
  const controller = createLockController({
    settings: { locked: true, openAtLogin: true, autoLock: true }
  });
  const state = controller.getState();
  assert.equal(state.locked, false);
  assert.equal(state.hookActive, false);
  assert.equal(canPresentLocked(state), false);
  assert.equal(state.settings.lockHotkey.key, 'K');
  assert.equal('locked' in state.settings, false);
});

test('refuses to lock when the hook is not active', function () {
  const controller = createLockController();
  const requested = controller.requestLock();
  assert.equal(requested.ok, false);
  assert.equal(requested.actions[0].type, 'hook-missing');
  assert.equal(controller.getState().locked, false);

  const chord = pressChord(controller, ['LCONTROL', 'LMENU'], 'K');
  assert.equal(chord.swallow, true);
  assert.equal(chord.actions[0].type, 'hook-missing');
  assert.equal(controller.getState().locked, false);
  assert.equal(canPresentLocked(controller.getState()), false);
});

test('lock hotkey locks only with an active hook and swallows the trigger', function () {
  const controller = createLockController();
  controller.setHookActive(true);
  const ctrl = down(controller, 'LCONTROL');
  const alt = down(controller, 'LMENU');
  assert.equal(ctrl.swallow, false);
  assert.equal(alt.swallow, false);
  const key = down(controller, 'K');
  assert.equal(key.swallow, true);
  assert.equal(key.actions.some(function (action) { return action.type === 'locked'; }), true);
  assert.equal(canPresentLocked(controller.getState()), true);
  assert.equal(up(controller, 'K').swallow, true);
  assert.equal(up(controller, 'LMENU').swallow, false);
});

test('extra modifier does not trigger lock or unlock', function () {
  const controller = createLockController();
  controller.setHookActive(true);
  const locked = pressChord(controller, ['LCONTROL', 'LMENU', 'LSHIFT'], 'K');
  assert.equal(controller.getState().locked, false);
  assert.equal(locked.actions.length, 0);
  release(controller, ['K', 'LSHIFT', 'LMENU', 'LCONTROL']);
  pressChord(controller, ['LCONTROL', 'LMENU'], 'K');
  assert.equal(controller.getState().locked, true);
  release(controller, ['K', 'LMENU', 'LCONTROL']);
  const attempt = pressChord(controller, ['LCONTROL', 'LMENU', 'LSHIFT'], 'L');
  assert.equal(controller.getState().locked, true);
  assert.equal(attempt.actions.some(function (action) { return action.type === 'wrong-attempt'; }), true);
});

test('plain keys are swallowed quietly while locked', function () {
  const controller = createLockController();
  controller.setHookActive(true);
  controller.requestLock();
  const letter = down(controller, 'A');
  assert.equal(letter.swallow, true);
  assert.equal(letter.actions.length, 0);
  assert.equal(down(controller, 'L').actions.length, 0);
});

test('wrong unlock chord asks for a toast, the real one unlocks', function () {
  const controller = createLockController();
  controller.setHookActive(true);
  controller.requestLock();
  const wrong = pressChord(controller, ['LCONTROL', 'LMENU'], 'P');
  assert.equal(wrong.actions.some(function (action) { return action.type === 'wrong-attempt'; }), true);
  assert.equal(controller.getState().locked, true);
  release(controller, ['P', 'LMENU', 'LCONTROL']);

  const partial = pressChord(controller, ['LCONTROL'], 'L');
  assert.equal(partial.actions.some(function (action) { return action.type === 'wrong-attempt'; }), true);
  release(controller, ['L', 'LCONTROL']);

  const again = pressChord(controller, ['LCONTROL', 'LMENU'], 'K');
  assert.equal(again.actions.some(function (action) { return action.type === 'wrong-attempt'; }), false);
  assert.equal(controller.getState().locked, true);
  release(controller, ['K', 'LMENU', 'LCONTROL']);

  const unlock = pressChord(controller, ['LCONTROL', 'LMENU'], 'L');
  assert.equal(unlock.actions.some(function (action) { return action.type === 'unlocked' && action.via === 'hotkey'; }), true);
  assert.equal(controller.getState().locked, false);
  assert.equal(up(controller, 'L').swallow, true);
  assert.equal(up(controller, 'LMENU').swallow, true);
  assert.equal(down(controller, 'A').swallow, false);
});

test('Alt+Tab and Win are swallowed only while locked', function () {
  const controller = createLockController();
  controller.setHookActive(true);
  assert.equal(down(controller, 'LWIN').swallow, false);
  up(controller, 'LWIN');
  assert.equal(down(controller, 'LMENU').swallow, false);
  assert.equal(down(controller, 'TAB').swallow, false);
  up(controller, 'TAB');
  up(controller, 'LMENU');

  controller.requestLock();
  assert.equal(down(controller, 'LWIN').swallow, true);
  assert.equal(up(controller, 'LWIN').swallow, true);
  assert.equal(down(controller, 'LMENU').swallow, true);
  assert.equal(down(controller, 'TAB').swallow, true);
  assert.equal(up(controller, 'TAB').swallow, true);
  assert.equal(up(controller, 'LMENU').swallow, true);
});

test('Ctrl+Alt+Del does not unlock', function () {
  const controller = createLockController();
  controller.setHookActive(true);
  controller.requestLock();
  const del = pressChord(controller, ['LCONTROL', 'LMENU'], 'DELETE');
  assert.equal(controller.getState().locked, true);
  assert.equal(del.swallow, true);
  assert.equal(del.actions.some(function (action) { return action.type === 'unlocked'; }), false);
});

test('holding Esc for 3 seconds emergency-unlocks and a short press does not', function () {
  const controller = createLockController();
  controller.setHookActive(true);
  controller.requestLock();
  const started = down(controller, 'ESCAPE', 1000);
  assert.equal(started.actions[0].type, 'emergency');
  const mid = controller.tick(1000 + 1800);
  assert.equal(mid.type, 'emergency');
  assert.equal(mid.progress, 0.6);
  assert.equal(controller.getState().locked, true);
  assert.equal(controller.tick(1000 + EMERGENCY_MS - 1).type, 'emergency');
  const done = controller.tick(1000 + EMERGENCY_MS);
  assert.equal(done.via, 'emergency');
  assert.equal(controller.getState().locked, false);

  controller.requestLock();
  down(controller, 'ESCAPE', 5000);
  up(controller, 'ESCAPE');
  assert.equal(controller.tick(5000 + EMERGENCY_MS), null);
  assert.equal(controller.getState().locked, true);
});

test('key repeat does not lock twice or restart the emergency hold', function () {
  const controller = createLockController();
  controller.setHookActive(true);
  pressChord(controller, ['LCONTROL', 'LMENU'], 'K', 10);
  const repeat = down(controller, 'K', 40);
  assert.equal(repeat.actions.length, 0);
  assert.equal(controller.getState().locked, true);
  down(controller, 'ESCAPE', 100);
  const again = down(controller, 'ESCAPE', 150);
  assert.equal(again.actions.length, 0);
  const view = controller.emergencyView(100 + 500);
  assert.equal(view.elapsed, 500);
});

test('remapped hotkeys and capture do not lock by themselves', function () {
  const controller = createLockController();
  controller.setHookActive(true);
  controller.updateSettings({
    lockHotkey: { ctrl: true, shift: true, alt: false, win: false, key: 'J' },
    unlockHotkey: { ctrl: true, shift: true, alt: false, win: false, key: 'U' }
  });
  pressChord(controller, ['LCONTROL', 'LMENU'], 'K');
  assert.equal(controller.getState().locked, false);
  release(controller, ['K', 'LMENU', 'LCONTROL']);
  controller.setCapture('lock');
  const chord = pressChord(controller, ['LCONTROL', 'LSHIFT'], 'J');
  assert.equal(chord.actions[0].type, 'capture');
  assert.equal(chord.actions[0].hotkey.key, 'J');
  assert.equal(chord.actions[0].hotkey.alt, false);
  assert.equal(controller.getState().locked, false);
  release(controller, ['J', 'LSHIFT', 'LCONTROL']);

  pressChord(controller, ['LCONTROL', 'LSHIFT'], 'J');
  assert.equal(controller.getState().locked, true);
  release(controller, ['J', 'LSHIFT', 'LCONTROL']);
  controller.setCapture('unlock');
  const unlock = pressChord(controller, ['LCONTROL', 'LSHIFT'], 'U');
  assert.equal(unlock.actions.some(function (action) { return action.type === 'unlocked'; }), true);
  assert.equal(controller.getState().locked, false);
});

test('a dead hook force-unlocks instead of leaving a fake lock', function () {
  const controller = createLockController();
  controller.setHookActive(true);
  controller.requestLock();
  assert.equal(canPresentLocked(controller.getState()), true);
  const actions = controller.setHookActive(false);
  assert.equal(actions[0].type, 'force-unlocked');
  assert.equal(controller.getState().locked, false);
  assert.equal(canPresentLocked(controller.getState()), false);
});

test('tray unlock clears an in-progress emergency hold', function () {
  const controller = createLockController();
  controller.setHookActive(true);
  controller.requestLock();
  down(controller, 'ESCAPE', 10);
  controller.requestUnlock();
  assert.equal(controller.tick(10 + EMERGENCY_MS), null);
  assert.equal(controller.getState().locked, false);
});
