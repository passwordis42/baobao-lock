'use strict';

const { spawn } = require('child_process');
const electronPath = require('electron');

const child = spawn(electronPath, ['.'], {
  env: Object.assign({}, process.env, { BABAO_SMOKE: '1' }),
  stdio: ['ignore', 'pipe', 'pipe']
});

let out = '';
let err = '';
child.stdout.on('data', function (chunk) { out += chunk.toString(); });
child.stderr.on('data', function (chunk) { err += chunk.toString(); });

const timer = setTimeout(function () {
  child.kill('SIGKILL');
  console.error('smoke timed out');
  console.error(err);
  process.exit(1);
}, 30000);

child.on('exit', function (code) {
  clearTimeout(timer);
  const line = out.trim().split('\n').filter(Boolean).pop();
  if (!line) {
    console.error(err);
    process.exit(1);
  }
  const payload = JSON.parse(line);
  if (payload.locked || payload.canPresentLocked || code !== 0) {
    console.error(payload);
    process.exit(1);
  }
  console.log(JSON.stringify(payload));
});
