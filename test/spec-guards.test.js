'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  });
  return out;
}

test('windows hook is keyboard-only and boot does not auto-lock', function () {
  const srcFiles = walk(path.join(root, 'src'), []).filter(function (file) {
    return file.endsWith('.js');
  });
  const blob = srcFiles.map(function (file) { return fs.readFileSync(file, 'utf8'); }).join('\n');
  assert.equal(blob.includes('WH_MOUSE'), false);
  assert.equal(blob.includes('setLoginItemSettings'), false);
  assert.equal(blob.includes('openAtLogin'), false);
  assert.match(read('src/main/hook-win.js'), /WH_KEYBOARD_LL = 13/);
  assert.match(read('src/main/index.js'), /canPresentLocked/);
  assert.match(read('src/renderer/toast.html'), /哎呀，还锁着哦/);
  assert.match(read('src/renderer/settings.html'), /Ctrl\+Alt\+Del 无法拦截/);
  assert.match(read('src/renderer/settings.html'), /开机不会自动上锁/);
  assert.match(read('src/renderer/settings.html'), /鼠标照常用/);
  assert.match(read('package.json'), /Baobao-Lock-Setup-\$\{version\}/);
  assert.match(read('package.json'), /"version": "0\.1\.2"/);
  assert.match(read('package.json'), /"executableName": "BaobaoLock"/);
  assert.match(read('package.json'), /asInvoker/);
});

test('non-windows install refuses the hook', function () {
  const { createHook } = require('../src/main/hook');
  if (process.platform === 'win32') return;
  const hook = createHook();
  const result = hook.install();
  assert.equal(result.ok, false);
  assert.equal(hook.isActive(), false);
  assert.match(result.detail, /只支持 Windows/);
});

test('koffi can describe the keyboard hook struct', function () {
  let koffi;
  try {
    koffi = require('koffi');
  } catch (err) {
    assert.fail('koffi should be installed');
  }
  const hook = require('../src/main/hook-win');
  assert.equal(hook.WH_KEYBOARD_LL, 13);
  if (typeof koffi.sizeof === 'function') {
    assert.equal(koffi.sizeof(hook.KBDLLHOOKSTRUCT), 24);
  }
});
