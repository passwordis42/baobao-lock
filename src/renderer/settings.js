'use strict';

var draft = {
  lockHotkey: { ctrl: true, alt: true, shift: false, win: false, key: 'K' },
  unlockHotkey: { ctrl: true, alt: true, shift: false, win: false, key: 'L' },
  tipSound: true,
  alwaysOnTop: true
};
var hookActive = true;
var hookAwaiting = false;
var captureWhich = null;

var lockBtn = document.getElementById('lockBtn');
var unlockBtn = document.getElementById('unlockBtn');
var tipBtn = document.getElementById('tipSound');
var topBtn = document.getElementById('alwaysOnTop');
var errorEl = document.getElementById('error');
var banner = document.getElementById('banner');

function paintHotkey(button, hotkey, which) {
  if (captureWhich === which) {
    button.classList.add('capturing');
    button.textContent = '请按组合键…';
    return;
  }
  button.classList.remove('capturing');
  var label = window.BaobaoFormat.formatSpaced(hotkey);
  button.innerHTML = label + ' <small>改</small>';
}

function paintToggle(button, on) {
  button.classList.toggle('off', !on);
  button.setAttribute('aria-checked', on ? 'true' : 'false');
  var name = button.id === 'tipSound' ? '按错提示音' : '挂件置顶';
  button.setAttribute('aria-label', name + (on ? ' 开' : ' 关'));
}

function render() {
  paintHotkey(lockBtn, draft.lockHotkey, 'lock');
  paintHotkey(unlockBtn, draft.unlockHotkey, 'unlock');
  paintToggle(tipBtn, draft.tipSound);
  paintToggle(topBtn, draft.alwaysOnTop);
  if (hookActive === false && hookAwaiting) {
    banner.hidden = false;
    banner.textContent = '钩子已装上，请按任意键确认。确认前不会进入已上锁。';
  } else if (hookActive === false) {
    banner.hidden = false;
    banner.textContent = '键盘钩子未生效，现在没有锁住键盘。可以右键本程序，选择「以管理员身份运行」再试一次。';
  } else {
    banner.hidden = true;
  }
}

function showError(text) {
  if (!text) {
    errorEl.hidden = true;
    errorEl.textContent = '';
    return;
  }
  errorEl.hidden = false;
  errorEl.textContent = text;
}

function applyData(data) {
  if (!data) return;
  draft.lockHotkey = data.lockHotkey;
  draft.unlockHotkey = data.unlockHotkey;
  draft.tipSound = !!data.tipSound;
  draft.alwaysOnTop = data.alwaysOnTop !== false;
  hookActive = data.hookActive !== false;
  hookAwaiting = !!data.hookAwaiting;
  captureWhich = null;
  showError('');
  render();
}

function begin(which) {
  if (!window.baobao) return;
  if (captureWhich === which) {
    captureWhich = null;
    window.baobao.cancelCapture();
    render();
    return;
  }
  captureWhich = which;
  showError('');
  render();
  window.baobao.beginCapture(which);
}

lockBtn.addEventListener('click', function () { begin('lock'); });
unlockBtn.addEventListener('click', function () { begin('unlock'); });
tipBtn.addEventListener('click', function () {
  draft.tipSound = !draft.tipSound;
  render();
});
topBtn.addEventListener('click', function () {
  draft.alwaysOnTop = !draft.alwaysOnTop;
  render();
});

document.getElementById('cancelBtn').addEventListener('click', function () {
  if (window.baobao) window.baobao.closeSettings();
});
document.getElementById('closeBtn').addEventListener('click', function () {
  if (window.baobao) window.baobao.closeSettings();
});
document.getElementById('minBtn').addEventListener('click', function () {
  if (window.baobao) window.baobao.minimize();
});
document.getElementById('saveBtn').addEventListener('click', function () {
  if (!window.baobao) return;
  window.baobao.saveSettings({
    lockHotkey: draft.lockHotkey,
    unlockHotkey: draft.unlockHotkey,
    tipSound: draft.tipSound,
    alwaysOnTop: draft.alwaysOnTop
  }).then(function (result) {
    if (result && result.ok === false) showError(result.error || '没能保存。');
  });
});

var params = new URLSearchParams(location.search);
if (params.has('preview')) {
  document.body.classList.remove('app');
  document.body.classList.add('preview');
  if (params.get('preview') === 'hook-off') hookActive = false;
  render();
} else if (window.baobao) {
  window.baobao.bootstrap().then(applyData);
  window.baobao.on('settings-data', applyData);
  window.baobao.on('hotkey-captured', function (payload) {
    captureWhich = null;
    if (!payload || payload.error) {
      showError((payload && payload.error) || '这个组合键不能用。');
      render();
      return;
    }
    if (payload.target === 'lock') draft.lockHotkey = payload.hotkey;
    if (payload.target === 'unlock') draft.unlockHotkey = payload.hotkey;
    showError('');
    render();
  });
  window.baobao.on('capture-cancel', function () {
    captureWhich = null;
    render();
  });
}
