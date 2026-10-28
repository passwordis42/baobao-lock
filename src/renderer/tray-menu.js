'use strict';

var icon = document.getElementById('statusIcon');
var statusLine = document.getElementById('statusLine');
var lockShortcut = document.getElementById('lockShortcut');
var unlockShortcut = document.getElementById('unlockShortcut');

function apply(state) {
  if (!state) return;
  var kind = state.statusKind || (state.locked ? 'locked' : 'unlocked');
  var locked = kind === 'locked';
  icon.src = locked ? '../assets/icon-locked.svg' : '../assets/icon-unlocked.svg';
  statusLine.className = kind;
  statusLine.textContent = '● ' + (state.statusText || (locked ? '已上锁' : '未上锁'));
  if (state.lockText) lockShortcut.textContent = state.lockText;
  if (state.unlockText) unlockShortcut.textContent = state.unlockText;
}

document.querySelectorAll('.item').forEach(function (button) {
  button.addEventListener('mousedown', function (event) {
    event.preventDefault();
    if (!window.baobao) return;
    window.baobao.trayAction(button.getAttribute('data-action'));
  });
});

var params = new URLSearchParams(location.search);
if (params.has('preview')) {
  document.body.classList.remove('app');
  document.body.classList.add('preview');
  if (params.get('preview') === 'unlocked') {
    apply({ statusKind: 'unlocked', statusText: '未上锁', lockText: 'Ctrl+Alt+K', unlockText: 'Ctrl+Alt+L' });
  } else if (params.get('preview') === 'hook-off') {
    apply({ statusKind: 'hook-off', statusText: '钩子未生效', lockText: 'Ctrl+Alt+K', unlockText: 'Ctrl+Alt+L' });
  } else {
    apply({ statusKind: 'locked', statusText: '已上锁', lockText: 'Ctrl+Alt+K', unlockText: 'Ctrl+Alt+L' });
  }
} else if (window.baobao) {
  window.baobao.bootstrap().then(apply);
  window.baobao.on('tray-state', apply);
}
