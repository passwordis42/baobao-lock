'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApiLoader } = require('../src/main/api-loader');
const {
  describeHookException,
  describeWin32HookFailure,
  hookFailureMessage
} = require('../src/shared/messages');

function dll(name) {
  return {
    name: name,
    func: function (signature) {
      return function bound() { return signature; };
    }
  };
}

test('second loadApi still returns kernel32.func', function () {
  let loads = 0;
  const loadApi = createApiLoader(function (name) {
    loads += 1;
    return dll(name);
  });
  const first = loadApi();
  const second = loadApi();
  assert.equal(second.kernel32, first.kernel32);
  assert.equal(second.user32, first.user32);
  assert.equal(loads, 2);
  assert.doesNotThrow(function () {
    const GetModuleHandleW = second.kernel32.func(
      'void * __stdcall GetModuleHandleW(void *lpModuleName)'
    );
    assert.equal(typeof GetModuleHandleW, 'function');
  });
});

test('a failed first load does not poison the retry', function () {
  let kernelFails = true;
  let loads = 0;
  const loadApi = createApiLoader(function (name) {
    loads += 1;
    if (name === 'kernel32.dll' && kernelFails) throw new Error('transient');
    return dll(name);
  });
  assert.throws(function () { loadApi(); }, /加载 user32.dll \/ kernel32.dll 失败/);
  kernelFails = false;
  const second = loadApi();
  assert.equal(typeof second.kernel32.func, 'function');
  assert.equal(second.kernel32.func('x')(), 'x');
  assert.ok(loads >= 3);
});

test('a library without func is reported in Chinese and can be retried', function () {
  let bad = true;
  const loadApi = createApiLoader(function () {
    if (bad) return {};
    return dll('ok');
  });
  assert.throws(function () { loadApi(); }, /没有提供 func/);
  bad = false;
  const ok = loadApi();
  assert.equal(typeof ok.kernel32.func, 'function');
  assert.equal(typeof ok.user32.func, 'function');
});

test('JS crashes and Win32 failures use different detail copy', function () {
  const crashed = describeHookException(
    new TypeError("Cannot read properties of undefined (reading 'func')")
  );
  assert.match(crashed, /程序内部错误/);
  assert.match(crashed, /不是权限不足/);
  assert.match(crashed, /reading 'func'/);
  const win32 = describeWin32HookFailure(5);
  assert.match(win32, /系统错误码 5/);
  assert.match(win32, /不是脚本异常/);
  const dialog = hookFailureMessage({ detail: crashed });
  assert.match(dialog.message, /没有锁住/);
  assert.match(dialog.detail, /程序内部错误/);
  assert.match(dialog.detail, /不会假装已经锁住键盘/);
});
