'use strict';

var widget = document.getElementById('widget');
var mascot = document.getElementById('mascot');
var hint = document.getElementById('hint');
var pct = document.getElementById('pct');
var ringArc = document.getElementById('ringArc');
var lockedSvg = document.getElementById('mascot-locked').innerHTML;
var emergencySvg = document.getElementById('mascot-emergency').innerHTML;
var RING = 2 * Math.PI * 34;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function apply(state) {
  var emergency = state && state.mode === 'emergency';
  widget.classList.toggle('emergency', emergency);
  widget.classList.toggle('locked', !emergency);
  mascot.innerHTML = emergency ? emergencySvg : lockedSvg;
  if (!emergency) {
    var keys = (state && state.unlockParts) || ['Ctrl', 'Alt', 'L'];
    hint.innerHTML = '按 ' + keys.map(function (key) {
      return '<kbd>' + escapeHtml(key) + '</kbd>';
    }).join('+') + '<br/>解锁';
    return;
  }
  var progress = Math.max(0, Math.min(1, Number(state.progress) || 0));
  ringArc.style.strokeDasharray = RING.toFixed(2);
  ringArc.style.strokeDashoffset = (RING * (1 - progress)).toFixed(2);
  pct.textContent = state.holdText || '0.0 / 3 秒';
}

function bindDrag() {
  if (!window.baobao) return;
  var drag = null;
  widget.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return;
    drag = { x: event.screenX, y: event.screenY, id: event.pointerId };
    widget.setPointerCapture(event.pointerId);
  });
  widget.addEventListener('pointermove', function (event) {
    if (!drag || event.pointerId !== drag.id) return;
    var dx = event.screenX - drag.x;
    var dy = event.screenY - drag.y;
    if (!dx && !dy) return;
    drag.x = event.screenX;
    drag.y = event.screenY;
    window.baobao.widgetDrag({ dx: dx, dy: dy });
  });
  function end(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    drag = null;
    window.baobao.widgetDragEnd();
  }
  widget.addEventListener('pointerup', end);
  widget.addEventListener('pointercancel', end);
}

var params = new URLSearchParams(location.search);
if (params.has('preview')) {
  document.body.classList.remove('app');
  document.body.classList.add('preview');
  if (params.get('preview') === 'emergency') {
    apply({ mode: 'emergency', progress: 1.8 / 3, holdText: '1.8 / 3 秒', unlockParts: ['Ctrl', 'Alt', 'L'] });
  } else {
    apply({ mode: 'locked', unlockParts: ['Ctrl', 'Alt', 'L'] });
  }
} else if (window.baobao) {
  window.baobao.bootstrap().then(apply);
  window.baobao.on('widget-state', apply);
  bindDrag();
}
