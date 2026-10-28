'use strict';

/**
 * Copy shown when the keyboard hook is not actually swallowing keys.
 * The wording must say the keyboard is NOT locked.
 */

/** JS exception while installing the hook. Not a Win32 access-denied code. */
function describeHookException(err) {
  const message = err && err.message ? String(err.message) : String(err || '');
  return '程序内部错误，不是权限不足：' + message;
}

/** SetWindowsHookExW returned NULL. `code` is GetLastError. */
function describeWin32HookFailure(code) {
  return 'SetWindowsHookExW 失败（系统错误码 ' + code + '）。这是 Windows 返回的结果，不是脚本异常。';
}

function hookFailureMessage(result) {
  const detail = result && result.detail ? String(result.detail) : '';
  const lines = [
    '宝宝锁没能装上键盘钩子，所以不会进入已上锁状态，也不会假装已经锁住键盘。',
    '',
    '默认不需要管理员权限。若反复失败，可以右键本程序，选择「以管理员身份运行」再试一次。'
  ];
  if (detail) {
    lines.push('');
    lines.push('详情：' + detail);
  }
  return {
    title: '键盘钩子未生效',
    message: '键盘现在没有锁住',
    detail: lines.join('\n')
  };
}

function trayStatus(state) {
  if (!state || !state.hookActive) {
    return { text: '钩子未生效', kind: 'hook-off' };
  }
  if (state.locked) return { text: '已上锁', kind: 'locked' };
  return { text: '未上锁', kind: 'unlocked' };
}

function trayTooltip(state) {
  return '宝宝锁 · ' + trayStatus(state).text;
}

/** Widget / toast / tray may show the locked face only when the hook is live. */
function canPresentLocked(state) {
  return !!(state && state.hookActive && state.locked);
}

module.exports = {
  hookFailureMessage,
  describeHookException,
  describeWin32HookFailure,
  trayStatus,
  trayTooltip,
  canPresentLocked
};
