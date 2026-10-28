'use strict';

var titleEl = document.getElementById('title');
var subEl = document.getElementById('sub');
var soundEl = document.getElementById('sound');
var audioCtx = null;

function playSoft() {
  var Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audioCtx) audioCtx = new Ctx();
  var ctx = audioCtx;
  if (ctx.state === 'suspended') ctx.resume();
  var now = ctx.currentTime;
  var notes = [523.25, 659.25];
  notes.forEach(function (freq, index) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    var start = now + index * 0.09;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.045, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.22);
  });
}

function apply(payload) {
  if (!payload) return;
  if (payload.title) titleEl.textContent = payload.title;
  if (payload.sub) subEl.textContent = payload.sub;
  var sound = !!payload.sound;
  soundEl.classList.toggle('off', !sound);
  if (payload.playSound && sound) playSoft();
}

var params = new URLSearchParams(location.search);
if (params.has('preview')) {
  document.body.classList.remove('app');
  document.body.classList.add('preview');
  apply({
    title: '哎呀，还锁着哦',
    sub: '请按 Ctrl+Alt+L 解锁',
    sound: params.get('sound') !== '0',
    playSound: false
  });
} else if (window.baobao) {
  window.baobao.on('toast', apply);
}
